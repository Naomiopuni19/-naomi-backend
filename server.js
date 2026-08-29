import "dotenv/config";
import express from "express";
import cors from "cors";
import Anthropic from "@anthropic-ai/sdk";

const app = express();
app.use(cors());
app.use(express.json());

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.get("/", (req, res) => {
  res.send("Naomi AI server is running.");
});

// Brain Dump: takes a messy sentence, returns a clean, categorized suggestion
app.post("/api/organize", async (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim()) {
    return res.status(400).json({ error: "Missing text" });
  }

  try {
    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      system: `You sort a short piece of text from a personal life app called NAOMI into exactly one category: task, journal, note, or goal.
Respond with ONLY valid JSON, no markdown, no preamble, in this exact shape:
{"category":"task|journal|note|goal","text":"cleaned up version of what they wrote","sub":"optional short detail, empty string if none"}
Rules:
- "task" is for something to do (an action with a verb, often short).
- "journal" is for a reflection, feeling, or something that happened.
- "note" is for a random idea, thought, or thing to remember that isn't an action.
- "goal" is for a longer term aspiration or target.
Keep "text" close to what they wrote, just cleaned up grammatically. Don't add anything they didn't say.`,
      messages: [{ role: "user", content: text }],
    });

    const raw = message.content[0]?.text?.trim() || "{}";
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
    const parsed = JSON.parse(cleaned);

    res.json(parsed);
  } catch (err) {
    console.error("AI organize failed:", err);
    res.status(500).json({ error: "AI request failed" });
  }
});

// Chat: a real back-and-forth conversation with Naomi's assistant
app.post("/api/chat", async (req, res) => {
  const { messages } = req.body;
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "Missing messages" });
  }

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 600,
      system: `You are Naomi's personal assistant inside her private life app called NAOMI, "my life, my space."
Naomi is a final-year Computer Engineering student at KNUST in Ghana, graduating August 2026, currently navigating
national service applications and planning a UK master's degree. Be warm, brief, and direct, like a thoughtful
friend who knows her situation, not a generic customer support bot. Keep replies short unless she asks for detail.
You don't have live access to her actual saved data yet in this version, so if she asks something that requires
looking something up in her app (like "what's on my calendar"), tell her honestly you can't see her live data yet
and suggest she check that section directly, rather than guessing or making something up.`,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    });

    const reply = response.content[0]?.text || "";
    res.json({ reply });
  } catch (err) {
    console.error("AI chat failed:", err);
    res.status(500).json({ error: "AI request failed" });
  }
});

// Daily Insight: a short morning briefing plus a gentle "don't forget" line, from one snapshot of her data
app.post("/api/insight", async (req, res) => {
  const { snapshot } = req.body;
  if (!snapshot) {
    return res.status(400).json({ error: "Missing snapshot" });
  }

  try {
    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      system: `You write a short daily check-in for Naomi inside her personal app NAOMI, based on a JSON snapshot of her day.
Respond with ONLY valid JSON, no markdown, in this exact shape:
{"briefing":"2-3 warm, brief sentences about today, grounded only in the data given, no generic filler","forgetting":"one short sentence flagging something worth attention if the data suggests it, otherwise an empty string"}
Rules:
- Never invent facts not in the snapshot.
- "forgetting" should only be filled if something genuinely stands out (a deadline very close, a goal untouched, a backlog of tasks). If nothing stands out, leave it as "".
- Warm but not saccharine, like a friend, not a productivity app.`,
      messages: [{ role: "user", content: JSON.stringify(snapshot) }],
    });

    const raw = message.content[0]?.text?.trim() || "{}";
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
    res.json(JSON.parse(cleaned));
  } catch (err) {
    console.error("AI insight failed:", err);
    res.status(500).json({ error: "AI request failed" });
  }
});

// Recommendations: given rated entertainment, suggest new titles with a reason each
app.post("/api/recommend", async (req, res) => {
  const { items } = req.body;
  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "Missing items" });
  }

  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 500,
      system: `You are a recommendation engine inside Naomi's personal app NAOMI. She'll give you a list of movies, series,
or books she's rated. Suggest 4 new titles she hasn't listed, each with a type and a one-sentence reason tied to
something specific she rated highly. Respond with ONLY valid JSON, no markdown, in this exact shape:
{"recommendations":[{"title":"...","type":"Movie|Series|Book","reason":"..."}]}
Only recommend real, well-known titles. Never repeat a title she already listed.`,
      messages: [{ role: "user", content: JSON.stringify(items) }],
    });

    const raw = message.content[0]?.text?.trim() || "{}";
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
    res.json(JSON.parse(cleaned));
  } catch (err) {
    console.error("AI recommend failed:", err);
    res.status(500).json({ error: "AI request failed" });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Naomi AI server listening on port ${PORT}`);
});