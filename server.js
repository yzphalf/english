const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const compression = require('compression');
const QRCode = require('qrcode');
const session = require('express-session');
const Database = require('better-sqlite3');
const Redis = require('ioredis');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const SQLITE_PATH = path.join(__dirname, 'data', 'app.db');
const LEGACY_JSON_PATH = path.join(__dirname, 'data', 'db.json');
const GROUP_COUNT = 11;
const GROUPS = Array.from({ length: GROUP_COUNT }, (_, i) => i + 1);
const FIXED_TEST_TOPIC_ID = 'test-topic-01';
const FIXED_TEST_TOPIC_TITLE = '固定测试主题（请直接点我）';
const FIXED_TEST_TOPIC_PROMPT = '这是老师端固定测试主题，用于快速验证点击进入、分组筛选与讨论展示流程。';
const TEACHER_USERNAME = process.env.TEACHER_USERNAME || 'teacher';
const TEACHER_PASSWORD = process.env.TEACHER_PASSWORD || '123456';
const SESSION_SECRET = process.env.SESSION_SECRET || 'teacher-session-secret-change-me';
const REDIS_URL = (process.env.REDIS_URL || '').trim();
const RATE_LIMIT_COMMENT_PER_MIN = Number(process.env.RATE_LIMIT_COMMENT_PER_MIN) || 30;
const RATE_LIMIT_TEACHER_POST_PER_MIN = Number(process.env.RATE_LIMIT_TEACHER_POST_PER_MIN) || 10;
const RATE_LIMIT_LOGIN_PER_MIN = Number(process.env.RATE_LIMIT_LOGIN_PER_MIN) || 20;

const db = new Database(SQLITE_PATH);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

const redis = REDIS_URL ? new Redis(REDIS_URL, {
  maxRetriesPerRequest: 1,
  enableAutoPipelining: true,
  lazyConnect: true
}) : null;
let redisReady = false;
const localRateMap = new Map();

initSchema();
migrateFromLegacyJson();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', true);
app.disable('x-powered-by');

app.use(compression());
app.use(express.urlencoded({ extended: false }));
app.use(session({
  name: 'teacher.sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 8
  }
}));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  lastModified: true,
  maxAge: '6h'
}));

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS topics (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      prompt TEXT NOT NULL,
      created_at TEXT NOT NULL,
      closed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      topic_id TEXT NOT NULL,
      group_no INTEGER NOT NULL CHECK(group_no >= 1 AND group_no <= ${GROUP_COUNT}),
      author TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(topic_id) REFERENCES topics(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_topics_created_at ON topics(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_comments_topic_created_at ON comments(topic_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_comments_group_no ON comments(group_no);
  `);
}

function makeId() {
  return crypto.randomUUID().slice(0, 8);
}

function parseGroup(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > GROUP_COUNT) {
    return null;
  }
  return n;
}

function isTopicClosed(topic) {
  return Boolean(topic && topic.closedAt);
}

function createHttpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function mapTopicRow(row) {
  return {
    id: row.id,
    title: row.title,
    prompt: row.prompt,
    createdAt: row.created_at,
    closedAt: row.closed_at || null,
    comments: []
  };
}

function mapCommentRow(row) {
  return {
    id: row.id,
    group: row.group_no,
    author: row.author,
    content: row.content,
    createdAt: row.created_at
  };
}

function getAllTopics() {
  const topicRows = db.prepare(
    'SELECT id, title, prompt, created_at, closed_at FROM topics ORDER BY created_at DESC'
  ).all();

  if (topicRows.length === 0) {
    return [];
  }

  const topicMap = new Map();
  const topics = topicRows.map((row) => {
    const topic = mapTopicRow(row);
    topicMap.set(topic.id, topic);
    return topic;
  });

  const topicIds = topics.map((topic) => topic.id);
  const placeholders = topicIds.map(() => '?').join(',');
  const commentRows = db.prepare(
    `SELECT id, topic_id, group_no, author, content, created_at
     FROM comments
     WHERE topic_id IN (${placeholders})
     ORDER BY created_at ASC`
  ).all(...topicIds);

  commentRows.forEach((row) => {
    const topic = topicMap.get(row.topic_id);
    if (topic) {
      topic.comments.push(mapCommentRow(row));
    }
  });

  return topics;
}

function getTopicById(topicId) {
  const row = db.prepare(
    'SELECT id, title, prompt, created_at, closed_at FROM topics WHERE id = ?'
  ).get(topicId);

  if (!row) {
    return null;
  }

  const topic = mapTopicRow(row);
  const commentRows = db.prepare(
    'SELECT id, group_no, author, content, created_at FROM comments WHERE topic_id = ? ORDER BY created_at ASC'
  ).all(topicId);
  topic.comments = commentRows.map(mapCommentRow);
  return topic;
}

function createTopic({ id = makeId(), title, prompt, createdAt = new Date().toISOString(), closedAt = null }) {
  db.prepare(
    'INSERT INTO topics (id, title, prompt, created_at, closed_at) VALUES (?, ?, ?, ?, ?)'
  ).run(id, title, prompt, createdAt, closedAt);
}

function closeTopic(topicId) {
  const result = db.prepare(
    'UPDATE topics SET closed_at = COALESCE(closed_at, ?) WHERE id = ?'
  ).run(new Date().toISOString(), topicId);
  if (result.changes === 0) {
    throw createHttpError(404, 'Topic not found.');
  }
}

function reopenTopic(topicId) {
  const result = db.prepare('UPDATE topics SET closed_at = NULL WHERE id = ?').run(topicId);
  if (result.changes === 0) {
    throw createHttpError(404, 'Topic not found.');
  }
}

function deleteTopic(topicId) {
  const result = db.prepare('DELETE FROM topics WHERE id = ?').run(topicId);
  if (result.changes === 0) {
    throw createHttpError(404, 'Topic not found.');
  }
}

const insertCommentTx = db.transaction(({ topicId, group, author, content }) => {
  const topicRow = db.prepare('SELECT id, closed_at FROM topics WHERE id = ?').get(topicId);

  if (!topicRow) {
    throw createHttpError(404, 'Topic not found.');
  }
  if (topicRow.closed_at) {
    throw createHttpError(410, 'Topic has ended.');
  }

  db.prepare(
    'INSERT INTO comments (id, topic_id, group_no, author, content, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(makeId(), topicId, group, author, content, new Date().toISOString());
});

function ensureFixedTestTopic() {
  db.prepare(
    `INSERT INTO topics (id, title, prompt, created_at, closed_at)
     VALUES (?, ?, ?, ?, NULL)
     ON CONFLICT(id) DO NOTHING`
  ).run(FIXED_TEST_TOPIC_ID, FIXED_TEST_TOPIC_TITLE, FIXED_TEST_TOPIC_PROMPT, new Date().toISOString());
}

function migrateFromLegacyJson() {
  const topicCount = db.prepare('SELECT COUNT(1) AS count FROM topics').get().count;
  if (topicCount > 0 || !fs.existsSync(LEGACY_JSON_PATH)) {
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(LEGACY_JSON_PATH, 'utf8'));
  } catch (error) {
    console.warn('Skip db.json migration: invalid JSON');
    return;
  }

  if (!parsed || !Array.isArray(parsed.topics)) {
    return;
  }

  const migrateTx = db.transaction((topics) => {
    const insertTopicStmt = db.prepare(
      `INSERT OR IGNORE INTO topics (id, title, prompt, created_at, closed_at)
       VALUES (?, ?, ?, ?, ?)`
    );
    const insertCommentStmt = db.prepare(
      `INSERT OR IGNORE INTO comments (id, topic_id, group_no, author, content, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    );

    topics.forEach((topic) => {
      const topicId = (topic.id || makeId()).toString();
      const topicTitle = (topic.title || '').toString().trim();
      const topicPrompt = (topic.prompt || '').toString().trim();
      if (!topicTitle || !topicPrompt) {
        return;
      }

      insertTopicStmt.run(
        topicId,
        topicTitle,
        topicPrompt,
        topic.createdAt || new Date().toISOString(),
        topic.closedAt || null
      );

      if (!Array.isArray(topic.comments)) {
        return;
      }

      topic.comments.forEach((comment) => {
        const commentAuthor = (comment.author || '').toString().trim();
        const commentContent = (comment.content || '').toString().trim();
        if (!commentAuthor || !commentContent) {
          return;
        }
        const group = parseGroup(comment.group) || 1;
        insertCommentStmt.run(
          (comment.id || makeId()).toString(),
          topicId,
          group,
          commentAuthor,
          commentContent,
          comment.createdAt || new Date().toISOString()
        );
      });
    });
  });

  migrateTx(parsed.topics);
}

function getPublicBaseUrl(req) {
  const configured = (process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  if (configured) {
    return configured;
  }
  return `${req.protocol}://${req.get('host')}`;
}

function buildStudentTopicLink(req, topicId) {
  return `${getPublicBaseUrl(req)}/student/topics/${topicId}`;
}

function requireTeacherAuth(req, res, next) {
  if (req.session && req.session.teacherAuthed) {
    return next();
  }
  const nextPath = encodeURIComponent(req.originalUrl || '/teacher');
  return res.redirect(`/teacher/login?next=${nextPath}`);
}

function getClientIp(req) {
  const cfIp = (req.headers['cf-connecting-ip'] || '').toString().trim();
  if (cfIp) return cfIp;
  const xff = (req.headers['x-forwarded-for'] || '').toString();
  if (xff) return xff.split(',')[0].trim();
  return req.ip || 'unknown';
}

function localConsumeRateLimit(key, limit, windowSec) {
  const now = Date.now();
  const windowMs = windowSec * 1000;
  const existing = localRateMap.get(key);
  if (!existing || existing.expireAt <= now) {
    localRateMap.set(key, { count: 1, expireAt: now + windowMs });
    return { allowed: true, retryAfterSec: 0 };
  }

  existing.count += 1;
  const retryAfterSec = Math.max(1, Math.ceil((existing.expireAt - now) / 1000));
  if (existing.count > limit) {
    return { allowed: false, retryAfterSec };
  }
  return { allowed: true, retryAfterSec: 0 };
}

async function consumeRateLimit({ prefix, identity, limit, windowSec }) {
  const key = `${prefix}:${identity}`;
  if (!redis || !redisReady) {
    return localConsumeRateLimit(key, limit, windowSec);
  }

  try {
    const tx = redis.multi();
    tx.incr(key);
    tx.expire(key, windowSec, 'NX');
    tx.ttl(key);
    const result = await tx.exec();
    const count = Number(result[0][1]);
    let ttl = Number(result[2][1]);
    if (!Number.isFinite(ttl) || ttl < 0) {
      ttl = windowSec;
    }

    if (count > limit) {
      return { allowed: false, retryAfterSec: Math.max(1, ttl) };
    }
    return { allowed: true, retryAfterSec: 0 };
  } catch (error) {
    return localConsumeRateLimit(key, limit, windowSec);
  }
}

function rateLimit({ prefix, limit, windowSec }) {
  return async (req, res, next) => {
    try {
      const identity = getClientIp(req);
      const outcome = await consumeRateLimit({ prefix, identity, limit, windowSec });
      if (!outcome.allowed) {
        res.setHeader('Retry-After', String(outcome.retryAfterSec));
        return res.status(429).send('Too many requests, please try again later.');
      }
      return next();
    } catch (error) {
      return next();
    }
  };
}

app.get('/healthz', (req, res) => {
  res.status(200).json({ ok: true, ts: new Date().toISOString() });
});

app.get('/', (req, res) => {
  const group = parseGroup(req.query.group) || 1;
  res.redirect(`/student?group=${group}`);
});

app.get('/student', (req, res, next) => {
  try {
    const topics = getAllTopics()
      .filter((topic) => !isTopicClosed(topic))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const selectedGroup = parseGroup(req.query.group) || 1;
    res.render('index', { topics, groups: GROUPS, selectedGroup });
  } catch (err) {
    next(err);
  }
});

app.get('/teacher/login', (req, res) => {
  if (req.session && req.session.teacherAuthed) {
    return res.redirect('/teacher');
  }
  const nextPath = (req.query.next || '/teacher').toString();
  res.render('teacher-login', { error: null, nextPath });
});

app.post('/teacher/login', rateLimit({
  prefix: 'rl:teacher-login',
  limit: RATE_LIMIT_LOGIN_PER_MIN,
  windowSec: 60
}), (req, res) => {
  const username = (req.body.username || '').trim();
  const password = (req.body.password || '').trim();
  const nextPath = (req.body.next || '/teacher').toString();

  if (username === TEACHER_USERNAME && password === TEACHER_PASSWORD) {
    req.session.teacherAuthed = true;
    return res.redirect(nextPath.startsWith('/') ? nextPath : '/teacher');
  }

  return res.status(401).render('teacher-login', {
    error: '账号或密码错误',
    nextPath
  });
});

app.post('/teacher/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/teacher/login');
  });
});

app.get('/teacher', (req, res, next) => {
  if (!req.session || !req.session.teacherAuthed) {
    return requireTeacherAuth(req, res, next);
  }
  try {
    const topics = getAllTopics().sort((a, b) => {
      if (a.id === FIXED_TEST_TOPIC_ID) return -1;
      if (b.id === FIXED_TEST_TOPIC_ID) return 1;
      return b.createdAt.localeCompare(a.createdAt);
    });
    res.render('teacher', { topics });
  } catch (err) {
    next(err);
  }
});

app.get('/teacher/topics/:id', (req, res, next) => {
  if (!req.session || !req.session.teacherAuthed) {
    return requireTeacherAuth(req, res, next);
  }
  try {
    const topic = getTopicById(req.params.id);

    if (!topic) {
      return res.status(404).send('Topic not found.');
    }

    const selectedGroup = req.query.group === 'all'
      ? 'all'
      : (parseGroup(req.query.group) || 'all');

    const comments = [...topic.comments].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const filteredComments = selectedGroup === 'all'
      ? comments
      : comments.filter((comment) => comment.group === selectedGroup);

    const groupCommentCounts = GROUPS.reduce((acc, group) => {
      acc[group] = 0;
      return acc;
    }, {});
    comments.forEach((comment) => {
      if (groupCommentCounts[comment.group] !== undefined) {
        groupCommentCounts[comment.group] += 1;
      }
    });
    const studentTopicLink = buildStudentTopicLink(req, topic.id);

    res.render('teacher-watch', {
      topic,
      selectedGroup,
      filteredComments,
      groupCommentCounts,
      groups: GROUPS,
      studentTopicLink
    });
  } catch (err) {
    next(err);
  }
});

app.get('/teacher/topics/:id/qr', async (req, res, next) => {
  if (!req.session || !req.session.teacherAuthed) {
    return requireTeacherAuth(req, res, next);
  }
  try {
    const topic = getTopicById(req.params.id);

    if (!topic) {
      return res.status(404).send('Topic not found.');
    }

    const studentTopicLink = buildStudentTopicLink(req, topic.id);
    const svg = await QRCode.toString(studentTopicLink, {
      type: 'svg',
      width: 320,
      margin: 1,
      errorCorrectionLevel: 'M'
    });

    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(svg);
  } catch (err) {
    next(err);
  }
});

app.post('/teacher/topics', rateLimit({
  prefix: 'rl:teacher-topic-create',
  limit: RATE_LIMIT_TEACHER_POST_PER_MIN,
  windowSec: 60
}), (req, res, next) => {
  if (!req.session || !req.session.teacherAuthed) {
    return requireTeacherAuth(req, res, next);
  }
  const title = (req.body.title || '').trim();
  const prompt = (req.body.prompt || '').trim();

  if (!title || !prompt) {
    return res.status(400).send('Title and prompt are required.');
  }

  try {
    createTopic({ title, prompt });
    res.redirect('/teacher');
  } catch (err) {
    next(err);
  }
});

app.post('/teacher/topics/:id/close', (req, res, next) => {
  if (!req.session || !req.session.teacherAuthed) {
    return requireTeacherAuth(req, res, next);
  }
  try {
    closeTopic(req.params.id);
    res.redirect('/teacher');
  } catch (err) {
    next(err);
  }
});

app.post('/teacher/topics/:id/reopen', (req, res, next) => {
  if (!req.session || !req.session.teacherAuthed) {
    return requireTeacherAuth(req, res, next);
  }
  try {
    reopenTopic(req.params.id);
    res.redirect('/teacher');
  } catch (err) {
    next(err);
  }
});

app.post('/teacher/topics/:id/delete', (req, res, next) => {
  if (!req.session || !req.session.teacherAuthed) {
    return requireTeacherAuth(req, res, next);
  }
  try {
    deleteTopic(req.params.id);
    res.redirect('/teacher');
  } catch (err) {
    next(err);
  }
});

app.get('/topics/:id', (req, res) => {
  const group = parseGroup(req.query.group) || 1;
  res.redirect(`/student/topics/${req.params.id}?group=${group}`);
});

app.get('/student/topics/:id', (req, res, next) => {
  try {
    const topic = getTopicById(req.params.id);

    if (!topic) {
      return res.status(404).send('Topic not found.');
    }
    if (isTopicClosed(topic)) {
      return res.status(410).send('Topic has ended.');
    }

    const selectedGroup = parseGroup(req.query.group) || 1;
    const comments = [...topic.comments].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    res.render('topic', { topic, comments, selectedGroup, groups: GROUPS });
  } catch (err) {
    next(err);
  }
});

app.post('/topics/:id/comments', (req, res) => {
  res.redirect(307, `/student/topics/${req.params.id}/comments`);
});

app.post('/student/topics/:id/comments', rateLimit({
  prefix: 'rl:student-comment',
  limit: RATE_LIMIT_COMMENT_PER_MIN,
  windowSec: 60
}), (req, res, next) => {
  const author = (req.body.author || '').trim();
  const content = (req.body.content || '').trim();
  const group = parseGroup(req.body.group);

  if (!author || !content || !group) {
    return res.status(400).send('Name, comment and valid group are required.');
  }

  try {
    insertCommentTx({
      topicId: req.params.id,
      group,
      author,
      content
    });

    res.redirect(`/student/topics/${req.params.id}?group=${group}`);
  } catch (err) {
    next(err);
  }
});

app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) {
    console.error(err);
  }
  res.status(status).send(err.message || 'Internal Server Error');
});

async function initRateLimitBackend() {
  if (!redis) {
    return;
  }
  try {
    await redis.connect();
    redisReady = true;
    redis.on('error', () => {
      redisReady = false;
    });
  } catch (error) {
    redisReady = false;
    console.warn('Redis unavailable, using local in-process rate limiter');
  }
}

async function startServer() {
  ensureFixedTestTopic();
  await initRateLimitBackend();
  app.listen(PORT, HOST, () => {
    console.log(`Server running at http://${HOST}:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
