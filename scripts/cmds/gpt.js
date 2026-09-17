const fs = require("fs-extra");
const path = require("path");
const os = require("os");
const axios = require("axios");

// ================== CONFIG ==================
const API_KEY = "sk-oBBlEqjKpj26Uk70QJe1RY9VJDptruHu3P3YmuYaafVJp5WV";
const API_BASE = "https://neroai.carwraman.shop";
const MODEL = "cx/gpt-image-2.5";

// Image generation takes ~45s on this gateway, so the timeout must be generous.
const REQUEST_TIMEOUT = 300000;
const TMP_DIR = path.join(os.tmpdir(), "gpt-img-cmd");
const SIZE_PATTERN = /^(auto|\d{3,4}x\d{3,4})$/;
// ============================================

fs.ensureDirSync(TMP_DIR);

function extractSize(args) {
  const index = args.findIndex(arg => arg === "-size" || arg === "--size");
  if (index === -1) return { prompt: args.join(" ").trim(), size: "auto" };

  const size = (args[index + 1] || "").toLowerCase();
  const prompt = args.filter((_, i) => i !== index && i !== index + 1).join(" ").trim();
  if (!SIZE_PATTERN.test(size)) return { prompt, size: null };
  return { prompt, size };
}

async function generateImage(prompt, size) {
  const { data } = await axios.post(
    `${API_BASE}/v1/images/generations`,
    { model: MODEL, prompt, n: 1, size, output_format: "png" },
    {
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
      timeout: REQUEST_TIMEOUT,
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    }
  );

  if (data && data.error) throw new Error(data.error.message || "API returned an error");

  const first = data && Array.isArray(data.data) && data.data[0];
  if (!first) throw new Error("API response contained no image");

  if (first.b64_json) return { buffer: Buffer.from(first.b64_json, "base64") };
  if (first.url) return { url: first.url };
  throw new Error("API response contained no image data");
}

function describeError(error) {
  const apiError = error.response && error.response.data && error.response.data.error;
  if (apiError && apiError.message) return apiError.message;
  if (error.response) return `API returned HTTP ${error.response.status}`;
  if (error.code === "ECONNABORTED") return "Request timed out while generating the image";
  return error.message || "Unknown error";
}

module.exports = {
  config: {
    name: "gpt",
    version: "1.0.0",
    author: "rX",
    role: 0,
    shortDescription: "Generate an image from a text prompt with GPT image models",
    longDescription: "Generates an image from your prompt using the configured GPT image model. Pass -size WxH to request dimensions (default: auto). Note: this gateway may ignore the size hint and return its own aspect ratio.",
    category: "image",
    guide: "{pn} <prompt> [-size WxH]\nExample: {pn} a cute cat wearing a hat -size 1024x1024",
    countDown: 30
  },

  onStart: async function ({ message, args, event }) {
    const { prompt, size } = extractSize(args);

    if (size === null)
      return message.reply("Invalid size. Use `auto` or a value like `1024x1024`.");
    if (!prompt)
      return message.reply("Please provide a prompt.\nExample: `.gpt a cute cat wearing a hat`");

    await message.reaction("", event.messageID);

    let filePath;
    try {
      const result = await generateImage(prompt, size);

      let attachment;
      if (result.url) {
        attachment = await global.utils.getStreamFromURL(result.url);
      } else {
        filePath = path.join(TMP_DIR, `gpt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.png`);
        await fs.writeFile(filePath, result.buffer);
        attachment = fs.createReadStream(filePath);
      }

      await message.reaction("✅", event.messageID);
      const sent = await message.reply({ body: `"${prompt}"`, attachment });

      // Delete after a delay so the upload can finish first.
      if (filePath) setTimeout(() => fs.remove(filePath).catch(() => {}), 120000);
      return sent;
    } catch (error) {
      await message.reaction("❌", event.messageID);
      if (filePath) fs.remove(filePath).catch(() => {});
      return message.reply(`Failed to generate image: ${describeError(error)}`);
    }
  }
};
