const fs = require("fs/promises");
const path = require("path");
const { readSession } = require("./_lib/session");
const { setApiSecurityHeaders, setNoStore } = require("./_lib/security");

const TEMPLATE_DIR = path.join(__dirname, "_templates");

async function readTemplate(name) {
  return await fs.readFile(path.join(TEMPLATE_DIR, name), "utf8");
}

module.exports = async function pageHandler(req, res) {
  setApiSecurityHeaders(res);
  setNoStore(res);

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return res.status(405).send("Method not allowed");
  }

  const session = readSession(req);
  const template = session?.permissions?.dashboard ? "dashboard.html" : "login.html";
  const html = await readTemplate(template);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  if (req.method === "HEAD") return res.status(200).end();
  return res.status(200).send(html);
};
