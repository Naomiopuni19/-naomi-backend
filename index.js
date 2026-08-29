import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

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

  const { data: lastTask } = await supabase.from("tasks").select("created_at").order("created_at", { ascending: false }).limit(1).maybeSingle();
  const { data: lastJournal } = await supabase.from("journal_entries").select("created_at").order("created_at", { ascending: false }).limit(1).maybeSingle();
  const lastActivity = [lastTask?.created_at, lastJournal?.created_at].filter(Boolean).sort().reverse()[0];
  const inactiveDays = lastActivity ? daysSince(lastActivity) : null;

  return { tasks: tasks || [], upcoming, inactiveDays };
}

function shouldSend({ tasks, upcoming, inactiveDays }) {
  return tasks.length > 0 || upcoming.length > 0 || (inactiveDays !== null && inactiveDays >= 2);
}

function renderEmail({ tasks, upcoming, inactiveDays }) {
  const lines = [];
  if (inactiveDays !== null && inactiveDays >= 2) {
    lines.push(`It's been ${inactiveDays} days since you last checked in.`);
  }
  if (tasks.length > 0) {
    lines.push(`\nOpen tasks (${tasks.length}):`);
    tasks.slice(0, 8).forEach((t) => lines.push(`  - ${t.text}`));
  }
  if (upcoming.length > 0) {
    lines.push(`\nComing up in the next 7 days:`);
    upcoming.forEach((u) => lines.push(`  - ${u.label} (${u.source}), ${u.days} day${u.days === 1 ? "" : "s"}`));
  }
  lines.push(`\nOpen NAOMI: ${process.env.APP_URL || ""}`);
  return lines.join("\n");
}

function esc(str) {
  return String(str).replace(/[&<>"'']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function renderEmailHtml({ tasks, upcoming, inactiveDays }) {
  const appUrl = process.env.APP_URL || "#";

  const taskRows = tasks
    .slice(0, 8)
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
            ${u.days} day${u.days === 1 ? "" : "s"}
          </td>
        </tr>`
    )
    .join("");

  const inactiveBanner =
    inactiveDays !== null && inactiveDays >= 2
      ? `<p style="margin:0 0 24px;padding:14px 18px;background:#F3D9CE;border-radius:12px;color:#5C4433;font-size:14px;">
           It's been ${inactiveDays} days since you last checked in.
         </p>`
      : "";

  const tasksSection =
    tasks.length > 0
      ? `<p style="margin:28px 0 8px;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#6B5A48;">Open tasks</p>
         <table width="100%" cellpadding="0" cellspacing="0">${taskRows}</table>`
      : "";

  const upcomingSection =
    upcoming.length > 0
      ? `<p style="margin:28px 0 8px;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#6B5A48;">Coming up this week</p>
         <table width="100%" cellpadding="0" cellspacing="0">${upcomingRows}</table>`
      : "";

  return `
  <div style="background:#FBF6EF;padding:40px 16px;font-family:Georgia,'Times New Roman',serif;">
    <div style="max-width:480px;margin:0 auto;background:#FFFFFF;border-radius:20px;padding:36px 32px;border:1px solid #EEE0CE;">
      <p style="margin:0;font-size:22px;letter-spacing:0.1em;color:#2E241C;">NAOMI</p>
      <p style="margin:2px 0 24px;font-size:11px;color:#9A8A76;font-family:Arial,sans-serif;">my life, my space</p>

      <p style="margin:0 0 6px;font-size:20px;color:#2E241C;">Good to check in with you</p>
      <p style="margin:0 0 20px;font-size:13px;color:#9A8A76;font-family:Arial,sans-serif;">
        ${new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
      </p>

      ${inactiveBanner}
      ${tasksSection}
      ${upcomingSection}

      <a href="${appUrl}" style="display:inline-block;margin-top:32px;padding:12px 24px;background:#5C4433;color:#FBF6EF;border-radius:999px;text-decoration:none;font-size:13px;font-family:Arial,sans-serif;">
        Open NAOMI
      </a>

      <p style="margin:32px 0 0;font-size:11px;color:#B0A08A;font-family:Arial,sans-serif;">
        You don't need to have your whole life figured out today.
      </p>
    </div>
  </div>`;
}

async function main() {
  const digest = await buildDigest();

  if (!shouldSend(digest)) {
    console.log("Nothing worth sending today, skipping.");
    return;
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });

  await transporter.sendMail({
    from: `NAOMI <${process.env.GMAIL_USER}>`,
    to: process.env.RECIPIENT_EMAIL,
    subject: "Your check-in from NAOMI",
    text: renderEmail(digest),
    html: renderEmailHtml(digest),
  });

  console.log("Digest email sent.");
}

main().catch((err) => {
  console.error("Digest job failed:", err);
  process.exit(1);
});