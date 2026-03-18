const express = require('express');
const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');
const compression = require('compression');
const QRCode = require('qrcode');
const session = require('express-session');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const DB_PATH = path.join(__dirname, 'data', 'db.json');
const GROUP_COUNT = 11;
const GROUPS = Array.from({ length: GROUP_COUNT }, (_, i) => i + 1);
const DB_REFRESH_MS = Number(process.env.DB_REFRESH_MS) || 1000;
const FIXED_TEST_TOPIC_ID = 'test-topic-01';
const FIXED_TEST_TOPIC_TITLE = '固定测试主题（请直接点我）';
const FIXED_TEST_TOPIC_PROMPT = '这是老师端固定测试主题，用于快速验证点击进入、分组筛选与讨论展示流程。';
const TEACHER_USERNAME = process.env.TEACHER_USERNAME || 'teacher';
const TEACHER_PASSWORD = process.env.TEACHER_PASSWORD || '123456';
const SESSION_SECRET = process.env.SESSION_SECRET || 'teacher-session-secret-change-me';

let dbCache = null;
let dbCacheAt = 0;
let dbWriteQueue = Promise.resolve();

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

function cloneDB(db) {
  return JSON.parse(JSON.stringify(db));
}

async function readDB(options = {}) {
  const { force = false } = options;

  if (!force && dbCache && (Date.now() - dbCacheAt) <= DB_REFRESH_MS) {
    return cloneDB(dbCache);
  }

  const raw = await fs.readFile(DB_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  dbCache = parsed;
  dbCacheAt = Date.now();
  return cloneDB(parsed);
}

async function writeDBAtomically(db) {
  const tmpPath = `${DB_PATH}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(db, null, 2), 'utf8');
  await fs.rename(tmpPath, DB_PATH);
}

function enqueueDBWrite(mutator) {
  const job = dbWriteQueue.then(async () => {
    const latestDB = await readDB({ force: true });
    await mutator(latestDB);
    await writeDBAtomically(latestDB);
    dbCache = latestDB;
    dbCacheAt = Date.now();
  });

  dbWriteQueue = job.catch(() => {});
  return job;
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

async function ensureFixedTestTopic() {
  await enqueueDBWrite(async (db) => {
    const exists = db.topics.some((topic) => topic.id === FIXED_TEST_TOPIC_ID);
    if (exists) {
      return;
    }
    db.topics.push({
      id: FIXED_TEST_TOPIC_ID,
      title: FIXED_TEST_TOPIC_TITLE,
      prompt: FIXED_TEST_TOPIC_PROMPT,
      createdAt: new Date().toISOString(),
      closedAt: null,
      comments: []
    });
  });
}

app.get('/healthz', (req, res) => {
  res.status(200).json({ ok: true, ts: new Date().toISOString() });
});

app.get('/', (req, res) => {
  const group = parseGroup(req.query.group) || 1;
  res.redirect(`/student?group=${group}`);
});

app.get('/student', async (req, res, next) => {
  try {
    const db = await readDB();
    const topics = [...db.topics]
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

app.post('/teacher/login', (req, res) => {
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

app.get('/teacher', async (req, res, next) => {
  if (!req.session || !req.session.teacherAuthed) {
    return requireTeacherAuth(req, res, next);
  }
  try {
    const db = await readDB();
    const topics = [...db.topics].sort((a, b) => {
      if (a.id === FIXED_TEST_TOPIC_ID) return -1;
      if (b.id === FIXED_TEST_TOPIC_ID) return 1;
      return b.createdAt.localeCompare(a.createdAt);
    });
    res.render('teacher', { topics });
  } catch (err) {
    next(err);
  }
});

app.get('/teacher/topics/:id', async (req, res, next) => {
  if (!req.session || !req.session.teacherAuthed) {
    return requireTeacherAuth(req, res, next);
  }
  try {
    const db = await readDB();
    const topic = db.topics.find((t) => t.id === req.params.id);

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
    const db = await readDB();
    const topic = db.topics.find((t) => t.id === req.params.id);

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

app.post('/teacher/topics', async (req, res, next) => {
  if (!req.session || !req.session.teacherAuthed) {
    return requireTeacherAuth(req, res, next);
  }
  const title = (req.body.title || '').trim();
  const prompt = (req.body.prompt || '').trim();

  if (!title || !prompt) {
    return res.status(400).send('Title and prompt are required.');
  }

  try {
    await enqueueDBWrite(async (db) => {
      db.topics.push({
        id: makeId(),
        title,
        prompt,
        createdAt: new Date().toISOString(),
        closedAt: null,
        comments: []
      });
    });

    res.redirect('/teacher');
  } catch (err) {
    next(err);
  }
});

app.post('/teacher/topics/:id/close', async (req, res, next) => {
  if (!req.session || !req.session.teacherAuthed) {
    return requireTeacherAuth(req, res, next);
  }
  try {
    await enqueueDBWrite(async (db) => {
      const topic = db.topics.find((t) => t.id === req.params.id);

      if (!topic) {
        const error = new Error('Topic not found.');
        error.status = 404;
        throw error;
      }

      if (!topic.closedAt) {
        topic.closedAt = new Date().toISOString();
      }
    });

    res.redirect('/teacher');
  } catch (err) {
    next(err);
  }
});

app.post('/teacher/topics/:id/reopen', async (req, res, next) => {
  if (!req.session || !req.session.teacherAuthed) {
    return requireTeacherAuth(req, res, next);
  }
  try {
    await enqueueDBWrite(async (db) => {
      const topic = db.topics.find((t) => t.id === req.params.id);

      if (!topic) {
        const error = new Error('Topic not found.');
        error.status = 404;
        throw error;
      }

      topic.closedAt = null;
    });

    res.redirect('/teacher');
  } catch (err) {
    next(err);
  }
});

app.post('/teacher/topics/:id/delete', async (req, res, next) => {
  if (!req.session || !req.session.teacherAuthed) {
    return requireTeacherAuth(req, res, next);
  }
  try {
    await enqueueDBWrite(async (db) => {
      const index = db.topics.findIndex((t) => t.id === req.params.id);

      if (index === -1) {
        const error = new Error('Topic not found.');
        error.status = 404;
        throw error;
      }

      db.topics.splice(index, 1);
    });

    res.redirect('/teacher');
  } catch (err) {
    next(err);
  }
});

app.get('/topics/:id', (req, res) => {
  const group = parseGroup(req.query.group) || 1;
  res.redirect(`/student/topics/${req.params.id}?group=${group}`);
});

app.get('/student/topics/:id', async (req, res, next) => {
  try {
    const db = await readDB();
    const topic = db.topics.find((t) => t.id === req.params.id);

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

app.post('/student/topics/:id/comments', async (req, res, next) => {
  const author = (req.body.author || '').trim();
  const content = (req.body.content || '').trim();
  const group = parseGroup(req.body.group);

  if (!author || !content || !group) {
    return res.status(400).send('Name, comment and valid group are required.');
  }

  try {
    await enqueueDBWrite(async (db) => {
      const topic = db.topics.find((t) => t.id === req.params.id);

      if (!topic) {
        const error = new Error('Topic not found.');
        error.status = 404;
        throw error;
      }
      if (isTopicClosed(topic)) {
        const error = new Error('Topic has ended.');
        error.status = 410;
        throw error;
      }

      topic.comments.push({
        id: makeId(),
        group,
        author,
        content,
        createdAt: new Date().toISOString()
      });
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

async function startServer() {
  await ensureFixedTestTopic();
  app.listen(PORT, HOST, () => {
    console.log(`Server running at http://${HOST}:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
