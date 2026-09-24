const express = require("express");
const Database = require("better-sqlite3");
const { nanoid } = require("nanoid");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const db = new Database(process.env.DB_FILE || path.join(__dirname, "vibemeter.db"));
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS quizzes (
  id TEXT PRIMARY KEY,
  owner_name TEXT NOT NULL,
  title TEXT NOT NULL,
  questions_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS responses (
  id TEXT PRIMARY KEY,
  quiz_id TEXT NOT NULL,
  respondent_name TEXT NOT NULL,
  answers_json TEXT NOT NULL,
  score INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (quiz_id) REFERENCES quizzes(id)
);
`);

app.use(express.json({limit:"1mb"}));
app.use(express.static(path.join(__dirname, "public")));

function cleanString(v, max=500) {
  return String(v ?? "").trim().slice(0,max);
}

app.post("/api/quizzes", (req,res)=>{
  const owner = cleanString(req.body.owner_name,80);
  const title = cleanString(req.body.title,160);
  const questions = Array.isArray(req.body.questions) ? req.body.questions : [];
  if (!owner || !title || !questions.length) return res.status(400).json({error:"Missing quiz details."});

  const normalized = questions.map(q => ({
    text: cleanString(q.text,300),
    options: Array.isArray(q.options) ? q.options.slice(0,5).map(x=>cleanString(x,160)) : [],
    correct: Number.isInteger(q.correct) ? q.correct : 0
  })).filter(q=>q.text && q.options.length >= 2);

  if (!normalized.length) return res.status(400).json({error:"Add at least one valid question."});

  const id = nanoid(10);
  db.prepare("INSERT INTO quizzes VALUES (?,?,?,?,?)")
    .run(id, owner, title, JSON.stringify(normalized), new Date().toISOString());

  res.json({id, share_url:`/quiz/${id}`});
});

app.get("/api/quizzes/:id", (req,res)=>{
  const q = db.prepare("SELECT id,owner_name,title,questions_json,created_at FROM quizzes WHERE id=?").get(req.params.id);
  if (!q) return res.status(404).json({error:"Quiz not found."});
  const questions = JSON.parse(q.questions_json).map(x=>({text:x.text, options:x.options}));
  res.json({id:q.id,owner_name:q.owner_name,title:q.title,questions});
});

app.post("/api/quizzes/:id/responses", (req,res)=>{
  const quiz = db.prepare("SELECT questions_json FROM quizzes WHERE id=?").get(req.params.id);
  if (!quiz) return res.status(404).json({error:"Quiz not found."});

  const name = cleanString(req.body.respondent_name,80);
  const answers = Array.isArray(req.body.answers) ? req.body.answers : [];
  if (!name || answers.length !== JSON.parse(quiz.questions_json).length)
    return res.status(400).json({error:"Please complete the quiz."});

  const questions = JSON.parse(quiz.questions_json);
  let score = 0;
  answers.forEach((a,i)=>{ if (Number(a) === questions[i].correct) score++; });
  const percent = Math.round(score / questions.length * 100);

  const id = nanoid(12);
  db.prepare("INSERT INTO responses VALUES (?,?,?,?,?,?)")
    .run(id, req.params.id, name, JSON.stringify(answers.map(Number)), percent, new Date().toISOString());

  res.json({ok:true, score:percent});
});

app.get("/api/quizzes/:id/responses", (req,res)=>{
  const quiz = db.prepare("SELECT id,owner_name,title,questions_json FROM quizzes WHERE id=?").get(req.params.id);
  if (!quiz) return res.status(404).json({error:"Quiz not found."});
  const questions = JSON.parse(quiz.questions_json);
  const rows = db.prepare("SELECT id,respondent_name,answers_json,score,created_at FROM responses WHERE quiz_id=? ORDER BY created_at DESC").all(req.params.id);
  const responses = rows.map(r=>({
    id:r.id,name:r.respondent_name,score:r.score,created_at:r.created_at,
    answers:JSON.parse(r.answers_json).map((a,i)=>({question:questions[i]?.text || "",answer:questions[i]?.options?.[a] || "—"}))
  }));
  const avg = responses.length ? Math.round(responses.reduce((a,r)=>a+r.score,0)/responses.length) : null;
  res.json({quiz:{id:quiz.id,owner_name:quiz.owner_name,title:quiz.title},stats:{count:responses.length,average:avg,top:responses.length?Math.max(...responses.map(r=>r.score)):null},responses});
});

app.get("/quiz/:id", (req,res)=>res.sendFile(path.join(__dirname,"public","quiz.html")));
app.get("/dashboard/:id", (req,res)=>res.sendFile(path.join(__dirname,"public","dashboard.html")));

app.listen(PORT, ()=>console.log(`VibeMeter running on http://localhost:${PORT}`));