// Shows which server the app is trying (passed as ?server=...).
const server = new URLSearchParams(location.search).get("server") || "";
const where = document.getElementById("where");
if (server) { where.textContent = "Server: "; const c = document.createElement("code"); c.textContent = server; where.appendChild(c); }
// The venue moved to another server: an admin of the new one moves this laptop there.
const sw = document.getElementById("switch");
if (window.atsuitApp && window.atsuitApp.switchServer) { sw.hidden = false; sw.onclick = () => window.atsuitApp.switchServer(); }
