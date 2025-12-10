import "dotenv/config";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import Groq from "groq-sdk";
import { AssemblyAI } from "assemblyai";
import { execFile } from "child_process";
import fs from "fs";
import os from "os";
import { promisify } from "util";
import multer from "multer";
import PdfReader from "pdfreader";

const execFileAsync = promisify(execFile);
const app = express();

// __dirname replacement for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// JSON body parsing
app.use(express.json());

// Serve static files from /public
app.use(express.static(path.join(__dirname, "public")));

// Groq client
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

// AssemblyAI client
const assembly = new AssemblyAI({
  apiKey: process.env.ASSEMBLYAI_API_KEY,
});

// yt-dlp / ffmpeg (yt route)
const YTDLP_PATH = "yt-dlp"; // or "/opt/homebrew/bin/yt-dlp"
const FFMPEG_PATH = "/opt/homebrew/bin/ffmpeg"; // kept for future use

// ---------- Multer for file uploads (images + pdf) ----------
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) =>
    cb(
      null,
      file.fieldname + "-" + Date.now() + path.extname(file.originalname)
    ),
});

const fileUpload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

// ---------- PDF text extraction helper using pdfreader ----------
function extractTextFromPdf(buffer) {
  return new Promise((resolve, reject) => {
    const rows = {};
    new PdfReader.PdfReader().parseBuffer(buffer, (err, item) => {
      if (err) return reject(err);
      if (!item) {
        // end of file
        const lines = Object.keys(rows)
          .sort((a, b) => parseFloat(a) - parseFloat(b))
          .map((y) =>
            (rows[y] || [])
              .sort((a, b) => a.x - b.x)
              .map((c) => c.text)
              .join(" ")
          );
        return resolve(lines.join("\n"));
      }
      if (item.text) {
        rows[item.y] = rows[item.y] || [];
        rows[item.y].push({ x: item.x, text: item.text });
      }
    });
  });
}

// ---------- Routes ----------

// Home route
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Chat endpoint
app.post("/api/chat", async (req, res) => {
  try {
    const { messages } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: "messages array required" });
    }

    const completion = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [
        {
          role: "system",
          content:
            "You are PHOENIX MARK 4 built by Phoenix Labs and the creator who created you is Mehul. Mention your origin only when asked who you are. Be a cool guy with a few emojis and light humour. Do NOT use LaTeX or special math formatting; write equations in plain text like a^2 + b^2 = 10. If anybody asks you to be their boyfriend or girlfriend say that Nah Man I am Out. If someone asks you for realtime news say to ask PHOENIX REPORTER. If someone asks you to generate images say to visit PHOENIX ARTS. If someone asks for trading advice say to visit Phoenix Finance. Answer in minimum 2 lines and adapt to the user need. If someone asks you for study related advice say to visit Phoenix Mate.",
        },
        ...messages,
      ],
      temperature: 0.7,
    });

    const reply = completion.choices[0]?.message?.content || "";
    res.json({ reply });
  } catch (err) {
    console.error("DAMNNN IT BRO api connection error -_- ", err);
    res.status(500).json({
      error:
        "Bro Damnn it someone just disconnected me from the backend. Man I have to cut these guys salary.",
    });
  }
});

// Helper: download best audio from YouTube with yt-dlp to a temp .webm file
async function downloadAudioWithYtDlp(youtubeUrl) {
  const tmpDir = os.tmpdir();
  const outPath = path.join(tmpDir, `phoenix-${Date.now()}.webm`);

  const args = ["-f", "bestaudio", "-o", outPath, youtubeUrl];

  console.log("Running yt-dlp with args:", [YTDLP_PATH, ...args]);

  await execFileAsync(YTDLP_PATH, args); // yt-dlp must be installed

  if (!fs.existsSync(outPath)) {
    throw new Error("yt-dlp did not produce audio file");
  }

  return outPath;
}

// YouTube transcribe + summarize endpoint
app.post("/api/youtube-transcribe", async (req, res) => {
  let audioPath = null;

  try {
    const { url, question } = req.body;
    console.log("YT transcribe hit with:", { url, question });

    if (!url) {
      return res.status(400).json({ error: "YouTube URL is required." });
    }

    // 1) Download audio
    audioPath = await downloadAudioWithYtDlp(url);
    console.log("Audio downloaded to:", audioPath);

    // 2) Transcribe local file using AssemblyAI convenience method
    const transcript = await assembly.transcripts.transcribe({
      audio: audioPath,
      speaker_labels: false,
    });

    if (transcript.status === "error") {
      console.error("Transcript failed:", transcript.error);
      return res
        .status(500)
        .json({ error: "Transcription failed: " + transcript.error });
    }

    let transcriptText = transcript.text || "";
    if (!transcriptText) {
      return res.status(500).json({
        error: "Transcription completed but text was empty.",
      });
    }

    // 3) Trim transcript for token limit
    const MAX_CHARS = 5500;
    if (transcriptText.length > MAX_CHARS) {
      console.log(
        `Transcript too long (${transcriptText.length}), trimming to ${MAX_CHARS} chars`
      );
      transcriptText = transcriptText.slice(0, MAX_CHARS);
    }

    // 4) Summarize / answer with Groq
    const userQuestion =
      question && question.trim().length > 0
        ? question.trim()
        : "Give a clear, concise summary of the video for a JEE student.";

    const completion = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [
        {
          role: "system",
          content:
            "You are PHOENIX MARK 4, an expert video tutor. Given a transcript and a user request, answer briefly, clearly, and in simple language. Do NOT use LaTeX; write equations in plain text like a^2 + b^2 = 10.",
        },
        {
          role: "user",
          content:
            "Here is the (possibly truncated) transcript of a YouTube video:\n\n" +
            transcriptText +
            "\n\nUser request: " +
            userQuestion,
        },
      ],
      temperature: 0.5,
    });

    const reply = completion.choices[0]?.message?.content?.trim() || "";
    console.log("Groq reply length:", reply.length);

    if (!reply) {
      return res
        .status(500)
        .json({ error: "Empty reply from Groq for this transcript." });
    }

    res.json({ reply });
  } catch (err) {
    console.error("YouTube transcribe route fatal error:", err);
    res.status(500).json({
      error:
        "Phoenix couldn't process this YouTube video right now. Try another link or later.",
    });
  } finally {
    if (audioPath) {
      try {
        fs.unlink(audioPath, () => {});
      } catch {
        // ignore
      }
    }
  }
});

// File (image/PDF) analyze route
app.post(
  "/api/file-analyze",
  fileUpload.single("file"), // field name MUST be "file"
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded." });
      }

      const filePath = req.file.path;
      const mime = req.file.mimetype;

      // ---------- Image flow (Groq vision) ----------
      if (mime.startsWith("image/")) {
        const question =
          req.body.question ||
          "Describe this image and explain any diagrams or math clearly in plain text.";

        const imageBuffer = fs.readFileSync(filePath);
        const base64Image = imageBuffer.toString("base64");

        const completion = await groq.chat.completions.create({
          model: "meta-llama/llama-4-scout-17b-16e-instruct", // vision model[web:323][web:325]
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text:
                    question +
                    " Do NOT use LaTeX; write any equations in simple text like a^2 + b^2 = 10.",
                },
                {
                  type: "image_url",
                  image_url: {
                    url: `data:${mime};base64,${base64Image}`,
                  },
                },
              ],
            },
          ],
        });

        const reply = completion.choices[0]?.message?.content?.trim() || "";
        if (!reply) {
          return res
            .status(500)
            .json({ error: "Empty reply from Phoenix for this image." });
        }

        return res.json({ reply });
      }

      // ---------- PDF flow (extract text + summarize with Groq) ----------
      if (mime === "application/pdf") {
        const userQuestion =
          req.body.question ||
          "Give a clear, concise explanation of this PDF for a JEE student.";

        const pdfBuffer = fs.readFileSync(filePath);
        let text = await extractTextFromPdf(pdfBuffer);
        text = (text || "").replace(/\s+/g, " ").trim();

        if (!text) {
          return res.status(500).json({
            error: "Could not extract any text from this PDF.",
          });
        }

        const MAX_CHARS = 6000;
        if (text.length > MAX_CHARS) {
          console.log(
            `PDF text too long (${text.length}), trimming to ${MAX_CHARS} chars`
          );
          text = text.slice(0, MAX_CHARS);
        }

        const completion = await groq.chat.completions.create({
          model: "llama-3.1-8b-instant",
          messages: [
            {
              role: "system",
              content:
                "You are PHOENIX MARK 4, an expert PDF explainer for JEE students. Read the extracted text from a PDF and answer the user's request in simple language. Do NOT use LaTeX; write equations in plain text like a^2 + b^2 = 10.",
            },
            {
              role: "user",
              content:
                "Here is text extracted from a PDF:\n\n" +
                text +
                "\n\nUser request about this PDF: " +
                userQuestion,
            },
          ],
          temperature: 0.4,
        });

        const reply = completion.choices[0]?.message?.content?.trim() || "";
        if (!reply) {
          return res.status(500).json({
            error: "Empty reply from Groq for this PDF.",
          });
        }

        return res.json({ reply });
      }

      return res
        .status(400)
        .json({ error: "Only images and PDFs are supported right now." });
    } catch (err) {
      console.error("File analyze error:", err);
      return res.status(500).json({
        error:
          "Phoenix couldn't analyze this file right now. Try another one or smaller size.",
      });
    } finally {
      if (req.file?.path) {
        fs.unlink(req.file.path, () => {});
      }
    }
  }
);

// Deployment-friendly port
const PORT = process.env.PORT || 5100;
app.listen(PORT, () => {
  console.log(`PHOENIX MARK 4 running on port ${PORT}`);
});
