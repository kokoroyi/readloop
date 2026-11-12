PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ---------- 文章 ----------
CREATE TABLE IF NOT EXISTS articles (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  title           TEXT    NOT NULL,
  content         TEXT    NOT NULL,                     -- 清洗后的正文
  content_hash    TEXT    NOT NULL,                     -- sha256(清洗后正文)，重复导入检测
  source_format   TEXT    NOT NULL DEFAULT 'paste',     -- paste|txt|md
  source_name     TEXT,                                 -- 原文件名（可选）
  status          TEXT    NOT NULL DEFAULT 'queued',    -- queued|reading|recap|done
  queue_order     INTEGER NOT NULL DEFAULT 0,
  sentence_count  INTEGER NOT NULL DEFAULT 0,
  processed_count INTEGER NOT NULL DEFAULT 0,
  skipped_count   INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT    NOT NULL,
  started_at      TEXT,                                 -- 首次进入精读
  completed_at    TEXT,                                 -- 生成小结时间
  updated_at      TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_articles_status_queue ON articles(status, queue_order);
CREATE INDEX IF NOT EXISTS idx_articles_updated ON articles(updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_articles_hash ON articles(content_hash);

-- ---------- 句子（导入时固化） ----------
CREATE TABLE IF NOT EXISTS sentences (
  article_id  INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  idx         INTEGER NOT NULL,
  text        TEXT    NOT NULL,
  start_off   INTEGER NOT NULL,
  end_off     INTEGER NOT NULL,
  PRIMARY KEY (article_id, idx)
);

-- ---------- 逐句工作 ----------
CREATE TABLE IF NOT EXISTS sentence_work (
  article_id      INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  idx             INTEGER NOT NULL,
  my_translation  TEXT,
  status          TEXT    NOT NULL DEFAULT 'pending',  -- pending|submitting|corrected|skipped|error
  correction_json TEXT,                                -- Correction
  model           TEXT,
  prompt_version  TEXT,
  submitted_at    TEXT,
  corrected_at    TEXT,
  updated_at      TEXT    NOT NULL,
  PRIMARY KEY (article_id, idx)
);
CREATE INDEX IF NOT EXISTS idx_work_status ON sentence_work(article_id, status);

-- ---------- 句内追问 ----------
CREATE TABLE IF NOT EXISTS sentence_chats (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id  INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  idx         INTEGER NOT NULL,
  role        TEXT    NOT NULL,                        -- user|assistant
  content     TEXT    NOT NULL,
  partial     INTEGER NOT NULL DEFAULT 0,              -- 流式中断的半成品
  created_at  TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sentence_chats ON sentence_chats(article_id, idx, id);

-- ---------- 复盘 ----------
CREATE TABLE IF NOT EXISTS recap_sessions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id      INTEGER NOT NULL UNIQUE REFERENCES articles(id) ON DELETE CASCADE,
  questions_json  TEXT    NOT NULL,                    -- RecapQuestion[]
  answers_json    TEXT    NOT NULL DEFAULT '[]',       -- RecapAnswer[]
  messages_json   TEXT    NOT NULL DEFAULT '[]',       -- 自由提问/点评消息流
  status          TEXT    NOT NULL DEFAULT 'asking',   -- asking|finished
  prompt_version  TEXT,
  model           TEXT,
  created_at      TEXT    NOT NULL,
  finished_at     TEXT
);

-- ---------- 学习小结 ----------
CREATE TABLE IF NOT EXISTS summaries (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id      INTEGER NOT NULL UNIQUE REFERENCES articles(id) ON DELETE CASCADE,
  data_json       TEXT    NOT NULL,                    -- SummaryData
  user_notes      TEXT    NOT NULL DEFAULT '',
  prompt_version  TEXT,
  model           TEXT,
  degraded        INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT    NOT NULL,
  updated_at      TEXT    NOT NULL
);

-- ---------- 收藏词 ----------
CREATE TABLE IF NOT EXISTS words (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  lemma             TEXT    NOT NULL UNIQUE,
  display           TEXT    NOT NULL,
  phonetic          TEXT,
  translation       TEXT,
  pos               TEXT,
  collins           INTEGER,
  bnc               INTEGER,
  frq               INTEGER,
  source_article_id INTEGER REFERENCES articles(id) ON DELETE SET NULL,
  created_at        TEXT    NOT NULL,
  updated_at        TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_words_created ON words(created_at DESC);

-- ---------- 阅读计时 ----------
CREATE TABLE IF NOT EXISTS reading_sessions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id     INTEGER REFERENCES articles(id) ON DELETE SET NULL,
  started_at     TEXT    NOT NULL,
  ended_at       TEXT,
  active_seconds INTEGER NOT NULL DEFAULT 0,
  processed_at_end INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sessions_started ON reading_sessions(started_at);

-- ---------- 设置 / AI 调用 / 日志 ----------
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_calls (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  purpose        TEXT    NOT NULL,   -- correct|followup|recap_questions|recap_evaluate|recap_chat|summary|test|models
  prompt_id      TEXT,
  prompt_version TEXT,
  model          TEXT,
  status         TEXT    NOT NULL,   -- ok|error|degraded
  prompt_preview TEXT,
  error          TEXT,
  duration_ms    INTEGER,
  input_tokens   INTEGER,
  output_tokens  INTEGER,
  created_at     TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_calls_created ON ai_calls(created_at);

CREATE TABLE IF NOT EXISTS logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  level      TEXT NOT NULL,          -- info|warn|error
  module     TEXT,
  message    TEXT NOT NULL,
  detail     TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_logs_created ON logs(created_at);
