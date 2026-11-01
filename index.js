import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";
import webpush from "web-push";
import Anthropic from "@anthropic-ai/sdk";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

webpush.setVapidDetails(
  "mailto:efyanaomi18@gmail.com",
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

const STYLES = [
  "a playful text from a best friend, relaxed and lowercase feeling, one emoji at most",
  "calm and grounding, like a quiet note from someone who believes in her",
  "hype woman energy, confident and encouraging",
  "short and direct, like a caring older sister, no fluff",
  "gentle and curious, asks one soft question",
  "dry, funny and affectionate, a little teasing",
  "warm and poetic, one vivid image, still brief",
];

async function sendPushToAllDevices(userId, title, body) {
  const { data: subs } = await supabase.from("push_subscriptions").select("*").eq("user_id", userId);
  const payload = JSON.stringify({ title, body, url: process.env.APP_URL || "/" });
  await Promise.allSettled(
    (subs || []).map(async (row) => {
      try {
        await webpush.sendNotification(row.subscription, payload);
      } catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          await supabase.from("push_subscriptions").delete().eq("id", row.id);
        }
      }
    })
  );
}

function daysUntil(dateStr) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  target.setHours(0, 0, 0, 0);
  return Math.round((target - today) / 86400000);
}

function daysSince(dateStr) {
  return Math.round((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

async function buildDigest() {
  const { data: tasks } = await supabase.from("tasks").select("*").eq("done", false);

  const { data: events } = await supabase.from("events").select("*");
  const { data: courses } = await supabase.from("education_courses").select("*").neq("status", "done");
  const { data: loveDates } = await supabase.from("love_dates").select("*");
  const { data: milestones } = await supabase.from("timeline_milestones").select("*");

  const upcoming = [
    ...(events || []).map((e) => ({ label: e.title, date: e.date, source: "Home" })),
    ...(courses || []).filter((c) => c.exam_date).map((c) => ({ label: c.name, date: c.exam_date, source: "Education" })),
    ...(loveDates || []).map((d) => ({ label: d.label, date: d.date, source: "Love Life" })),
    ...(milestones || []).map((m) => ({ label: m.title, date: m.date, source: "Timeline" })),
  ]
    .map((i) => ({ ...i, days: daysUntil(i.date) }))
    .filter((i) => i.days >= 0 && i.days <= 7)
    .sort((a, b) => a.days - b.days);

  // Last activity: the newest row across tasks, journal and sleep log
  const { data: lastTask } = await supabase.from("tasks").select("created_at").order("created_at", { ascending: false }).limit(1).maybeSingle();
  const { data: lastJournal } = await supabase.from("journal_entries").select("created_at").order("created_at", { ascending: false }).limit(1).maybeSingle();
  const { data: lastSleep } = await supabase.from("sleep_log").select("created_at").order("created_at", { ascending: false }).limit(1).maybeSingle();
  const lastActivity = [lastTask?.created_at, lastJournal?.created_at, lastSleep?.created_at].filter(Boolean).sort().reverse()[0];
  const inactiveDays = lastActivity ? daysSince(lastActivity) : null;

  const hoursSinceSleep = lastSleep?.created_at ? (Date.now() - new Date(lastSleep.created_at)) / 3600000 : null;

  const { data: entertainment } = await supabase.from("entertainment_items").select("created_at").order("created_at", { ascending: false }).limit(1);
  const daysSinceWatching = entertainment?.[0] ? daysSince(entertainment[0].created_at) : null;

  const { data: careerApps } = await supabase.from("career_apps").select("created_at, status").order("created_at", { ascending: false }).limit(1);
  const daysSinceApplication = careerApps?.[0] ? daysSince(careerApps[0].created_at) : null;

  return {
    tasks: tasks || [],
    upcoming,
    inactiveDays,
    hoursSinceSleep,
    daysSinceWatching,
    daysSinceApplication,
  };
}

// Decides if anything is worth sending right now. Returns null when nothing is.
// Morning run (before 12:00 UTC): event reminders at 3 days, 1 day and 0 days.
// Evening run: a check in if she has been quiet for 2+ days, every second day.
function decideReason(digest, manual) {
  const morning = new Date().getUTCHours() < 12;
  const dueEvents = digest.upcoming.filter((u) => [0, 1, 3].includes(u.days));
  const away = digest.inactiveDays !== null && digest.inactiveDays >= 2 && digest.inactiveDays % 2 === 0;

  if (manual) {
    if (dueEvents.length > 0) return { type: "event", events: dueEvents };
    if (away) return { type: "checkin" };
    return { type: "test" };
  }
  if (morning && dueEvents.length > 0) return { type: "event", events: dueEvents };
  if (!morning && away) return { type: "checkin" };
  return null;
}

function clean(s) {
  return String(s || "").replace(/[-\u2013\u2014]/g, " ").replace(/\s+/g, " ").trim();
}

function whenWord(days) {
  return days === 0 ? "today" : days === 1 ? "tomorrow" : "in " + days + " days";
}

async function generateMessage(digest, reason) {
  const style = STYLES[Math.floor(Math.random() * STYLES.length)];

  let context;
  if (reason.type === "event") {
    context =
      "Remind her about these coming up items. days is how far away: 0 is today, 1 is tomorrow. Name them specifically: " +
      JSON.stringify(reason.events.map((e) => ({ label: e.label, days: e.days })));
  } else if (reason.type === "checkin") {
    context =
      "She has not added or logged anything in the app for " + digest.inactiveDays +
      " days. Check in on her like a friend who misses hearing from her. Ask how she is. You may lightly mention ONE thing from the snapshot (sleep, something to watch, applications, open tasks), never all of them.";
  } else {
    context = "This is a test message. Write a warm check in so she can see what the style looks like.";
  }

  const fallback =
    reason.type === "event"
      ? {
          subject: "Coming up " + whenWord(reason.events[0].days),
          line: reason.events.map((e) => e.label + " is " + whenWord(e.days)).join(". ") + ".",
        }
      : { subject: "Thinking of you", line: "Hey you. How are you doing today?" };

  try {
    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 250,
      system:
        "You write one short notification for Naomi inside her personal app NAOMI.\n" +
        "Style for this message: " + style + ".\n" +
        context + "\n" +
        "Rules: one or two sentences, 220 characters at most. Never use hyphens or dashes of any kind. " +
        "Never guilt trip, never sound robotic, never mention data fields or numbers like they are a report. " +
        "The subject is under 50 characters, varied every time, and does not have to include the word NAOMI or check in.\n" +
        'Respond with ONLY JSON in this exact shape, no markdown: {"subject":"...","line":"..."}',
      messages: [{ role: "user", content: JSON.stringify({ snapshot: digest }) }],
    });
    const raw = message.content[0]?.text?.trim() || "{}";
    const parsed = JSON.parse(raw.replace(/^```json\s*/i, "").replace(/```$/, "").trim());
    const subject = clean(parsed.subject);
    const line = clean(parsed.line);
    if (!subject || !line) return fallback;
    return { subject, line };
  } catch (err) {
    console.error("Message generation failed:", err);
    return fallback;
  }
}

function esc(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function renderEmail({ tasks, upcoming, msg, showTasks }) {
  const lines = [msg.line];
  if (showTasks && tasks.length > 0) {
    lines.push("\nOpen tasks (" + tasks.length + "):");
    tasks.slice(0, 5).forEach((t) => lines.push("  \u2022 " + t.text));
  }
  if (upcoming.length > 0) {
    lines.push("\nComing up:");
    upcoming.forEach((u) => lines.push("  \u2022 " + u.label + " (" + u.source + "), " + whenWord(u.days)));
  }
  lines.push("\nOpen NAOMI: " + (process.env.APP_URL || ""));
  return lines.join("\n");
}

function renderEmailHtml({ tasks, upcoming, msg, showTasks }) {
  const appUrl = process.env.APP_URL || "#";

  const taskRows = tasks
    .slice(0, 5)
    .map(
      (t) => `
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #EEE0CE;font-size:14px;color:#2E241C;">${esc(t.text)}</td>
        </tr>`
    )
    .join("");

  const upcomingRows = upcoming
    .map(
      (u) => `
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #EEE0CE;font-size:14px;color:#2E241C;">
            ${esc(u.label)}
            <span style="color:#9A8A76;font-size:12px;"> &middot; ${esc(u.source)}</span>
          </td>
          <td style="padding:10px 0;border-bottom:1px solid #EEE0CE;font-size:12px;color:#8A5A44;text-align:right;white-space:nowrap;">
            ${esc(whenWord(u.days))}
          </td>
        </tr>`
    )
    .join("");

  const tasksSection =
    showTasks && tasks.length > 0
      ? `<p style="margin:28px 0 8px;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#6B5A48;">Open tasks</p>
         <table width="100%" cellpadding="0" cellspacing="0">${taskRows}</table>`
      : "";

  const upcomingSection =
    upcoming.length > 0
      ? `<p style="margin:28px 0 8px;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#6B5A48;">Coming up</p>
         <table width="100%" cellpadding="0" cellspacing="0">${upcomingRows}</table>`
      : "";

  return `
  <div style="background:#FBF6EF;padding:40px 16px;font-family:Georgia,'Times New Roman',serif;">
    <div style="max-width:480px;margin:0 auto;background:#FFFFFF;border-radius:20px;padding:36px 32px;border:1px solid #EEE0CE;">
      <p style="margin:0;font-size:22px;letter-spacing:0.1em;color:#2E241C;">NAOMI</p>
      <p style="margin:2px 0 24px;font-size:11px;color:#9A8A76;font-family:Arial,sans-serif;">my life, my space</p>

      <p style="margin:0 0 6px;font-size:20px;color:#2E241C;">${esc(msg.subject)}</p>
      <p style="margin:0 0 20px;font-size:13px;color:#9A8A76;font-family:Arial,sans-serif;">
        ${new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
      </p>

      <p style="margin:0 0 24px;padding:14px 18px;background:#F3D9CE;border-radius:12px;color:#5C4433;font-size:14px;">
        ${esc(msg.line)}
      </p>

      ${upcomingSection}
      ${tasksSection}

      <a href="${appUrl}" style="display:inline-block;margin-top:32px;padding:12px 24px;background:#5C4433;color:#FBF6EF;border-radius:999px;text-decoration:none;font-size:13px;font-family:Arial,sans-serif;">
        Open NAOMI
      </a>
    </div>
  </div>`;
}

async function main() {
  const manual = process.env.GITHUB_EVENT_NAME === "workflow_dispatch";
  const digest = await buildDigest();
  const reason = decideReason(digest, manual);

  if (!reason) {
    console.log("Nothing worth sending right now, skipping.");
    return;
  }
  console.log("Sending because: " + reason.type);

  const msg = await generateMessage(digest, reason);
  const isEvent = reason.type === "event";
  const payload = {
    tasks: digest.tasks,
    upcoming: isEvent ? reason.events : digest.upcoming,
    msg,
    showTasks: !isEvent,
  };

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });

  await transporter.sendMail({
    from: "NAOMI <" + process.env.GMAIL_USER + ">",
    to: process.env.RECIPIENT_EMAIL,
    subject: msg.subject,
    text: renderEmail(payload),
    html: renderEmailHtml(payload),
  });
  console.log("Email sent.");

  const { data: anySub } = await supabase.from("push_subscriptions").select("user_id").limit(1).maybeSingle();
  if (anySub) {
    await sendPushToAllDevices(anySub.user_id, msg.subject, msg.line);
    console.log("Push notification sent.");
  } else {
    console.log("No push subscription on file yet, skipping push.");
  }
}

main().catch((err) => {
  console.error("Digest job failed:", err);
  process.exit(1);
});