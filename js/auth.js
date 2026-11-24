/* Inicio de sesión (solo cuando la app está conectada a Supabase).
   - Entrar con email y contraseña.
   - "¿Olvidaste tu contraseña?" envía un enlace al correo.
   - Al abrir el enlace de invitación o de recuperación, se pide crear la contraseña.
   - Si la cuenta no está en la lista de autorizados, se avisa y no se muestra ningún dato. */

const AUTH_HASH = location.hash; // se lee antes de que Supabase limpie la dirección

const Auth = {
  el: null,
  user: null,

  show(mode, info = "") {
    this.el = document.getElementById("auth");
    document.documentElement.classList.add("auth-open");
    this.el.hidden = false;
    this.el.querySelectorAll("[data-auth-mode]").forEach(f => { f.hidden = f.dataset.authMode !== mode; });
    const msg = this.el.querySelector(`[data-auth-mode="${mode}"] .auth-msg`);
    if (msg) { msg.textContent = info; msg.hidden = !info; }
    const first = this.el.querySelector(`[data-auth-mode="${mode}"] input, [data-auth-mode="${mode}"] button`);
    if (first) setTimeout(() => first.focus(), 30);
  },

  hide() {
    if (!this.el) return;
    this.el.hidden = true;
    document.documentElement.classList.remove("auth-open");
  },

  error(mode, text) {
    const msg = this.el.querySelector(`[data-auth-mode="${mode}"] .auth-msg`);
    msg.textContent = text;
    msg.hidden = false;
    msg.classList.add("is-error");
  },

  friendly(err) {
    const m = (err && err.message) || "";
    if (/invalid login credentials/i.test(m)) return "El email o la contraseña no coinciden.";
    if (/email not confirmed/i.test(m)) return "Falta confirmar el email. Revisa tu correo.";
    if (/password should be at least|weak password/i.test(m)) return "La contraseña es muy corta. Usa al menos 10 caracteres.";
    if (/rate limit|too many/i.test(m)) return "Demasiados intentos. Espera un minuto y vuelve a probar.";
    if (/fetch|network/i.test(m)) return "No hay conexión con el servidor. Revisa tu internet.";
    return m || "Algo salió mal. Vuelve a intentarlo.";
  },

  busy(form, on) {
    form.querySelectorAll("button, input").forEach(x => { x.disabled = on; });
  },

  /* Espera a que la persona complete el formulario del modo indicado. */
  wait(mode) {
    return new Promise(resolve => { this._resolve = { mode, resolve }; });
  },

  bind() {
    const db = Cloud.client;
    const forms = this.el.querySelectorAll("form[data-auth-mode]");
    forms.forEach(form => form.addEventListener("submit", async e => {
      e.preventDefault();
      const mode = form.dataset.authMode;
      this.busy(form, true);
      try {
        if (mode === "login") {
          const email = form.email.value.trim().toLowerCase();
          const { data, error } = await db.auth.signInWithPassword({ email, password: form.password.value });
          if (error) throw error;
          this.user = data.user;
          this.done("login");
        } else if (mode === "reset") {
          const email = form.email.value.trim().toLowerCase();
          const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
          if (error) throw error;
          this.show("login", "Te enviamos un enlace para crear una contraseña nueva. Revisa tu correo.");
        } else if (mode === "password") {
          const p1 = form.password.value, p2 = form.password2.value;
          if (p1.length < 10) throw new Error("Weak password");
          if (p1 !== p2) { this.error("password", "Las dos contraseñas no son iguales."); return; }
          const { data, error } = await db.auth.updateUser({ password: p1 });
          if (error) throw error;
          this.user = data.user;
          this.done("password");
        }
      } catch (err) {
        this.error(mode, this.friendly(err));
      } finally {
        this.busy(form, false);
      }
    }));
    this.el.querySelectorAll("[data-auth-go]").forEach(b => b.addEventListener("click", () => this.show(b.dataset.authGo)));
    this.el.querySelectorAll("[data-auth-signout]").forEach(b => b.addEventListener("click", () => this.signOut()));
  },

  done(mode) {
    if (this._resolve && this._resolve.mode === mode) { const r = this._resolve.resolve; this._resolve = null; r(); }
  },

  async isAuthorized() {
    const email = (this.user && this.user.email || "").toLowerCase();
    const { data, error } = await Cloud.client.from("usuarios_autorizados").select("email").eq("email", email).maybeSingle();
    if (error) throw error;
    return !!data;
  },

  /* Devuelve cuando hay una sesión autorizada. */
  async start() {
    this.el = document.getElementById("auth");
    this.show("loading");
    await Cloud.connect();
    this.bind();
    const db = Cloud.client;
    const fromEmailLink = /type=(invite|recovery)/.test(AUTH_HASH);

    const { data: { session } } = await db.auth.getSession();
    if (session) this.user = session.user;

    if (session && fromEmailLink) {
      this.show("password");
      await this.wait("password");
    } else if (!session) {
      this.show("login");
      await this.wait("login");
    }
    if (/access_token|type=/.test(location.hash) || !location.hash) history.replaceState(null, "", location.pathname + "#inicio");

    if (!(await this.isAuthorized())) {
      this.el.querySelector("[data-auth-email]").textContent = this.user.email;
      this.show("denied");
      await new Promise(() => {}); // sin acceso: la app no continúa
    }
    this.hide();
    Cloud.user = this.user;
    db.auth.onAuthStateChange(event => { if (event === "SIGNED_OUT") location.reload(); });
  },

  async signOut() {
    try { await Cloud.client.auth.signOut(); } finally { location.hash = "#inicio"; location.reload(); }
  }
};
