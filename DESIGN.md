# English Speaking Board Design System

## Product Direction
- Product type: content-first discussion platform for English class.
- Core interaction: browse topics quickly, enter discussion quickly, read comments clearly.
- Visual benchmark: Discourse/Flarum style clarity, Apple-like neutral polish.

## Design Goals
- Prioritize readable content over decorative visuals.
- Keep hierarchy obvious at a glance: page title -> section title -> topic -> metadata.
- Reduce wasted whitespace while keeping enough breathing room.
- Keep all cards, controls, and typography consistent across student and teacher pages.

## Visual Language
- Tone: clean, neutral, classroom-professional.
- Density: medium-dense, no oversized empty hero blocks.
- Shape: soft rounded corners, subtle borders, light shadows.
- Motion: minimal and functional (hover elevation, loading state).

## Color System
- Background: neutral cool gray gradient, low contrast.
- Surface: white cards with light gray borders.
- Primary: blue for navigation and active actions.
- Semantic:
  - Danger: red for delete/end actions.
  - Warning: amber for restore/reopen actions.
  - Muted: gray for metadata and helper text.

## Typography
- Font stack: SF Pro Display/Text, PingFang SC, Hiragino Sans GB, Microsoft YaHei, sans-serif.
- Hierarchy:
  - H1: page identity.
  - H2: module title.
  - H3: card/topic title.
  - Metadata: compact pill style.
- Title behavior:
  - Topic titles clamp to two lines to keep card heights consistent.

## Layout Rules
- Global width:
  - Student home: wide content region for multi-topic browsing.
  - Teacher watch: wide board for group comparison.
- Student homepage:
  - Two-column shell on desktop: main topic feed + right contextual sidebar.
  - Topic grid: 3 columns (wide), 2 columns (medium), 1 column (mobile).
- Card sizing:
  - Topic cards use a minimum height and fixed top/bottom information zones.
  - Metadata row anchors to the bottom for strict alignment.

## Component Rules
- Topbar:
  - Compact vertical padding.
  - One eyebrow + one clear page title.
- Buttons:
  - Primary: solid blue.
  - Secondary: tinted neutral/blue, not gradient-heavy.
  - Semantic buttons use dedicated colors.
- Pills/Chips:
  - Use for status and lightweight metadata only.
- Empty states:
  - Keep concise, one sentence, neutral tone.

## Content Patterns
- Topic list item must always include:
  - title
  - participation state
  - comment count
  - created time
- Teacher watch group board must include:
  - group label
  - comment count
  - comments in chronological order

## Responsive Strategy
- Desktop: information-dense with clear multi-column grids.
- Tablet: reduce one column step, preserve card rhythm.
- Mobile: single-column flow, no horizontal overflow, controls remain reachable.

## Anti-Patterns (Do Not Do)
- No oversized empty hero sections.
- No mixed visual styles (heavy gradients + flat buttons in same screen).
- No inconsistent card heights in a grid.
- No decorative effects that compete with discussion content.
