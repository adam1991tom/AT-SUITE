const $ = (id) => document.getElementById(id);
let mode = "enrol";
let admin = false;

function how(useAdmin) {
  admin = useAdmin;
  $("useCode").setAttribute("aria-pressed", String(!admin));
  $("useAdmin").setAttribute("aria-pressed", String(admin));
  $("codeBox").hidden = admin;
  $("adminBox").hidden = !admin;
  $("code").required = !admin;
  $("username").required = admin;
  $("password").required = admin;
}

window.setup.prefill().then((q) => {
  mode = q.mode || "enrol";
  $("server").value = q.server || "";
  $("code").value = q.code || "";
  $("name").value = q.name || "";
  $("msg").textContent = q.message || "";
  if (mode === "switch") {
    // Moving a laptop to another server: only an admin of the new server can do it.
    document.title = "Connect to a different server";
    $("title").textContent = "Connect to a different server";
    $("intro").textContent = "Move this laptop to another AT-SUITE server. An admin of the new server signs in here to allow it.";
    $("current").textContent = q.current || "";
    $("now").hidden = !q.current;
    $("howRow").hidden = true;
    $("cancel").hidden = false;
    $("go").textContent = "Connect to this server";
    how(true);
    $("server").focus();
  } else {
    how(false);
  }
});

$("useCode").onclick = () => { how(false); $("code").focus(); };
$("useAdmin").onclick = () => { how(true); $("username").focus(); };
$("cancel").onclick = () => window.setup.cancel();
// A different server has different sites.
$("server").oninput = () => { $("siteBox").hidden = true; $("site").innerHTML = ""; };

$("f").onsubmit = async (e) => {
  e.preventDefault();
  const label = $("go").textContent;
  $("go").disabled = true;
  $("err").textContent = "";
  const form = { server: $("server").value, name: $("name").value };
  const r = admin
    ? await window.setup.enrolAdmin({ ...form, username: $("username").value, password: $("password").value, site_id: $("site").value ? +$("site").value : null })
    : await window.setup.enrol({ ...form, code: $("code").value });
  if (r.ok) { $("go").textContent = "Done. Opening the workspace…"; return; }
  if (r.sites && r.sites.length) {
    $("site").innerHTML = "";
    for (const s of r.sites) {
      const o = document.createElement("option");
      o.value = String(s.id);
      o.textContent = s.name;
      $("site").appendChild(o);
    }
    $("siteBox").hidden = false;
  }
  $("err").textContent = r.error || "That didn't work.";
  $("go").textContent = label;
  $("go").disabled = false;
};
