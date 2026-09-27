const express = require("express");
const { Pool } = require("pg");
const { nanoid } = require("nanoid");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is missing. Create/connect a PostgreSQL database in Render and add DATABASE_URL.");
  process.exit(1);
}
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
  max: 5
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS quizzes (
      id TEXT PRIMARY KEY,
      owner_name TEXT NOT NULL,
      title TEXT NOT NULL,
      questions_json TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE IF NOT EXISTS responses (
      id TEXT PRIMARY KEY,
      quiz_id TEXT NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
      respondent_name TEXT NOT NULL,
      answers_json TEXT NOT NULL,
      score INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL
    );
    CREATE INDEX IF NOT EXISTS responses_quiz_id_idx ON responses(quiz_id);
  `);
  console.log("VibeMeter database ready");
}

app.use(express.json({limit:"1mb"}));
app.use(express.static(path.join(__dirname, "public")));

function cleanString(v, max=500) { return String(v ?? "").trim().slice(0,max); }

app.post("/api/quizzes", async (req,res)=>{
  try {
    const owner = cleanString(req.body.owner_name,80);
    const title = cleanString(req.body.title,160);
    const questions = Array.isArray(req.body.questions) ? req.body.questions : [];
    if (!owner || !title || !questions.length) return res.status(400).json({error:"Missing quiz details."});
    const normalized = questions.map(q => ({
      text: cleanString(q.text,300),
      options: Array.isArray(q.options) ? q.options.slice(0,5).map(x=>cleanString(x,160)) : [],
      correct: Number.isInteger(q.correct) ? q.correct : null
    })).filter(q=>q.text && q.options.length === 5 && Number.isInteger(q.correct) && q.correct >= 0 && q.correct < q.options.length);
    if (!normalized.length || normalized.length !== questions.length) return res.status(400).json({error:"Every question must have exactly 5 options and a correct answer selected."});
    const id = nanoid(10);
    await pool.query("INSERT INTO quizzes (id,owner_name,title,questions_json,created_at) VALUES ($1,$2,$3,$4,$5)",[id,owner,title,JSON.stringify(normalized),new Date()]);
    res.json({id, share_url:`/quiz/${id}`, dashboard_url:`/dashboard/${id}`});
  } catch(e) { console.error(e); res.status(500).json({error:"Could not create quiz."}); }
});

app.get("/api/quizzes/:id", async (req,res)=>{
  try {
    const r = await pool.query("SELECT id,owner_name,title,questions_json,created_at FROM quizzes WHERE id=$1",[req.params.id]);
    const q = r.rows[0];
    if (!q) return res.status(404).json({error:"Quiz not found. The quiz may have been created before persistent storage was connected."});
    const questions = JSON.parse(q.questions_json).map(x=>({text:x.text, options:x.options}));
    res.json({id:q.id,owner_name:q.owner_name,title:q.title,questions});
  } catch(e) { console.error(e); res.status(500).json({error:"Could not load quiz."}); }
});

app.post("/api/quizzes/:id/responses", async (req,res)=>{
  try {
    const r = await pool.query("SELECT questions_json FROM quizzes WHERE id=$1",[req.params.id]);
    const quiz = r.rows[0];
    if (!quiz) return res.status(404).json({error:"Quiz not found."});
    const name = cleanString(req.body.respondent_name,80);
    const answers = Array.isArray(req.body.answers) ? req.body.answers : [];
    const questions = JSON.parse(quiz.questions_json);
    if (!name || answers.length !== questions.length) return res.status(400).json({error:"Please complete the quiz."});
    const validAnswers = answers.every((a,i)=>Number.isInteger(Number(a)) && Number(a) >= 0 && Number(a) < questions[i].options.length);
    if (!validAnswers) return res.status(400).json({error:"One or more answers are invalid."});
    let score = 0;
    answers.forEach((a,i)=>{ if (Number(a) === questions[i].correct) score++; });
    const percent = Math.round(score / questions.length * 100);
    const id = nanoid(12);
    await pool.query("INSERT INTO responses (id,quiz_id,respondent_name,answers_json,score,created_at) VALUES ($1,$2,$3,$4,$5,$6)",[id,req.params.id,name,JSON.stringify(answers.map(Number)),percent,new Date()]);
    res.json({ok:true,score:percent,correctCount:score,total:questions.length,review:questions.map((q,i)=>({question:q.text,selected:q.options[Number(answers[i])]||"—",correct:q.options[q.correct]||"—",correctIndex:q.correct,selectedIndex:Number(answers[i]),isCorrect:Number(answers[i])===q.correct}))});
  } catch(e) { console.error(e); res.status(500).json({error:"Could not save your answers. Please try again."}); }
});

app.get("/api/quizzes/:id/responses", async (req,res)=>{
  try {
    const qr = await pool.query("SELECT id,owner_name,title,questions_json FROM quizzes WHERE id=$1",[req.params.id]);
    const quiz = qr.rows[0];
    if (!quiz) return res.status(404).json({error:"Dashboard not found. Quiz not found."});
    const questions = JSON.parse(quiz.questions_json);
    const rr = await pool.query("SELECT id,respondent_name,answers_json,score,created_at FROM responses WHERE quiz_id=$1 ORDER BY created_at DESC",[req.params.id]);
    const responses = rr.rows.map(r=>({id:r.id,name:r.respondent_name,score:r.score,created_at:r.created_at,answers:JSON.parse(r.answers_json).map((a,i)=>({question:questions[i]?.text||"",answer:questions[i]?.options?.[a]||"—",correct:questions[i]?.options?.[questions[i]?.correct]||"—",isCorrect:Number(a)===questions[i]?.correct}))}));
    const avg = responses.length ? Math.round(responses.reduce((a,r)=>a+r.score,0)/responses.length) : null;
    res.json({quiz:{id:quiz.id,owner_name:quiz.owner_name,title:quiz.title},stats:{count:responses.length,average:avg,top:responses.length?Math.max(...responses.map(r=>r.score)):null},responses});
  } catch(e) { console.error(e); res.status(500).json({error:"Could not load dashboard."}); }
});

app.get("/api/health", async (req,res)=>{
  try { await pool.query("SELECT 1"); res.json({ok:true,service:"VibeMeter",database:"connected"}); }
  catch(e) { res.status(503).json({ok:false,service:"VibeMeter",database:"disconnected"}); }
});
app.get("/quiz/:id", (req,res)=>res.sendFile(path.join(__dirname,"public","quiz.html")));
app.get("/dashboard/:id", (req,res)=>res.sendFile(path.join(__dirname,"public","dashboard.html")));

initDb().then(()=>app.listen(PORT, ()=>console.log(`VibeMeter running on port ${PORT}`))).catch(e=>{console.error("Database initialization failed",e);process.exit(1);});
