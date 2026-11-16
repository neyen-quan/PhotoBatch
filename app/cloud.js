'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {durableWrite, syncDirectory, envelope, openEnvelope} = require('./util');

// Publishable client key, never a service-role credential.
const URL = 'https://rkuaogjbzuwxprkaxugd.supabase.co';
const KEY = 'sb_publishable_42wNqPtJIXrLrMaRo9s3RA_fNrkjlpw';
const MAX = 999999999;
function validCounters(value) {
  if (!value || !Number.isInteger(value.photo) || value.photo < -1 || value.photo > MAX ||
      !Number.isInteger(value.video) || value.video < 14098 || value.video > MAX) {
    throw Error('La numeración recibida no es válida. No se reinició el contador.');
  }
  return {photo: value.photo, video: value.video};
}
function atomicWrite(file, value) {
  const tmp = file + '.' + crypto.randomUUID() + '.tmp';
  try { durableWrite(tmp, value); fs.renameSync(tmp, file); syncDirectory(path.dirname(file)); }
  finally { fs.rmSync(tmp, {force: true}); }
}
function emailValue(value) {
  if (typeof value !== 'string' || value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()))
    throw Error('Ingresá un correo válido.');
  return value.trim().toLowerCase();
}
function passwordValue(value, creating = false) {
  if (typeof value !== 'string' || value.length > 256 || value.length < (creating ? 10 : 1))
    throw Error(creating ? 'Usá una contraseña de al menos 10 caracteres.' : 'Ingresá tu contraseña.');
  return value;
}
function friendlyError(data, status) {
  const code = data.error_code || data.code;
  const messages = {
    invalid_credentials: 'Correo o contraseña incorrectos.',
    email_not_confirmed: 'Falta confirmar tu correo. Pegá el enlace del correo de confirmación acá.',
    email_address_not_authorized: 'Supabase permite enviar correos solo a miembros del proyecto. Usá el correo con el que administrás Supabase.',
    over_email_send_rate_limit: 'Se alcanzó el límite de correos. Esperá antes de pedir otro; revisá también spam.',
    over_request_rate_limit: 'Demasiados intentos. Esperá unos minutos.',
    user_already_exists: 'Esa cuenta ya existe. Iniciá sesión.',
    otp_expired: 'El enlace venció o ya se usó. Intentá ingresar con tu contraseña o pedí otro.',
    weak_password: 'Elegí una contraseña más segura.',
  };
  const error = Error(messages[code] || (status === 429 ? 'Demasiados intentos. Esperá unos minutos.' :
    String(data.message || data.msg || data.error_description || 'No se pudo completar la operación en Supabase.').slice(0,400)));
  error.status = status;
  error.code = code;
  return error;
}

class Cloud {
  constructor({stateDir, secureStorage, fetchImpl = globalThis.fetch, localCounters}) {
    this.file = path.join(stateDir, 'account-session.bin');
    this.counterFile = path.join(stateDir, 'cloud-counters.json');
    this.storage = secureStorage;
    this.fetch = fetchImpl;
    this.localCounters = localCounters;
    this.session = null;
    this.counters = null;
    this.online = false;
    this.message = '';
    this.remembered = false;
    this.refreshing = null;
    this.floor = {photo:-1, video:14098};
    this.floorError = null;
    try { if (fs.existsSync(this.counterFile)) this.floor = validCounters(openEnvelope(fs.readFileSync(this.counterFile, 'utf8'))); }
    catch { this.floorError = 'El respaldo local de numeración está dañado. No se reinició el contador. Contactá soporte antes de exportar.'; this.message = this.floorError; }
  }
  async canRemember() {
    return Boolean(this.storage && await this.storage.isAsyncEncryptionAvailable() &&
      (process.platform !== 'linux' || this.storage.getSelectedStorageBackend?.() !== 'basic_text'));
  }
  async load() {
    if (!fs.existsSync(this.file)) return;
    try {
      if (!await this.canRemember()) throw Error('El sistema no pudo desbloquear la sesión.');
      const saved = JSON.parse(await this.storage.decryptStringAsync(fs.readFileSync(this.file)));
      if (typeof saved.refresh_token !== 'string' || !saved.user?.id) throw Error('Sesión inválida.');
      this.session = saved;
      this.remembered = true;
    } catch { this.message = 'Volvé a iniciar sesión en este equipo. La numeración sigue en tu cuenta.'; }
  }
  snapshot() {
    return {signedIn:Boolean(this.session), email:this.session?.user.email || '',
      online:this.online, counters:this.counters, remembered:this.remembered, message:this.message};
  }
  async request(route, body, token, method = 'POST') {
    let response;
    try {
      response = await this.fetch(URL + route, {method, redirect:'error', signal:AbortSignal.timeout(20000),
        headers:{apikey:KEY, 'Content-Type':'application/json', ...(token ? {Authorization:'Bearer '+token} : {})},
        ...(body === undefined ? {} : {body:JSON.stringify(body)})});
    } catch {
      this.online = false;
      throw Error('No se pudo conectar con PhotoBatch. Revisá Internet y reintentá. No se guardará un ZIP sin reservar su numeración.');
    }
    let data = {};
    const text = await response.text();
    if (text) { try { data = JSON.parse(text); } catch { throw Error('Supabase devolvió una respuesta inválida. Reintentá.'); } }
    if (!response.ok) throw friendlyError(data, response.status);
    return data;
  }
  async saveSession(data) {
    if (!data?.access_token || !data.refresh_token || !data.user?.id || !Number.isFinite(data.expires_in))
      throw Error('No se recibió una sesión válida.');
    this.session = {access_token:data.access_token, refresh_token:data.refresh_token,
      expires_at:data.expires_at || Math.floor(Date.now()/1000)+data.expires_in,
      user:{id:data.user.id,email:data.user.email}};
    this.remembered = false;
    if (await this.canRemember()) {
      atomicWrite(this.file, await this.storage.encryptStringAsync(JSON.stringify(this.session)));
      this.remembered = true;
    } else fs.rmSync(this.file, {force:true});
    this.message = this.remembered ? '' : 'La sesión dura hasta cerrar PhotoBatch: el sistema no dispone de almacenamiento seguro.';
  }
  async refresh() {
    if (!this.session) throw Error('Iniciá sesión desde Mi cuenta para sincronizar la numeración.');
    if (!this.refreshing) {
      const token = this.session.refresh_token;
      this.refreshing = (async () => {
        try { await this.saveSession(await this.request('/auth/v1/token?grant_type=refresh_token', {refresh_token:token})); }
        catch (error) {
          if ([400,401,403].includes(error.status)) {
            this.session = null; this.online = false; this.remembered = false;
            fs.rmSync(this.file,{force:true});
            throw Error('Tu sesión venció. Volvé a iniciar sesión; la numeración sigue guardada.');
          }
          throw error;
        }
      })().finally(() => { this.refreshing = null; });
    }
    return this.refreshing;
  }
  async authenticated(route, body, method = 'POST') {
    if (!this.session) throw Error('Iniciá sesión desde Mi cuenta para sincronizar la numeración.');
    if (this.session.expires_at <= Date.now()/1000 + 60) await this.refresh();
    try { return await this.request(route,body,this.session.access_token,method); }
    catch (error) {
      if (error.status !== 401) throw error;
      await this.refresh();
      return this.request(route,body,this.session.access_token,method);
    }
  }
  async signIn(email, password) {
    const data = await this.request('/auth/v1/token?grant_type=password',
      {email:emailValue(email),password:passwordValue(password)});
    await this.saveSession(data);
    this.counters = null;
    return this.sync();
  }
  async signUp(email, password) {
    const data = await this.request('/auth/v1/signup', {email:emailValue(email),password:passwordValue(password,true)});
    if (data.access_token) { await this.saveSession(data); return this.sync(); }
    return {confirmationRequired:true};
  }
  async sendRecovery(email) { await this.request('/auth/v1/recover',{email:emailValue(email)}); return {confirmationRequired:true}; }
  async resend(email) { await this.request('/auth/v1/resend',{email:emailValue(email),type:'signup'}); return {confirmationRequired:true}; }
  async verifyLink(link, newPassword) {
    // Parse only; never fetch a supplied URL or follow its redirect_to.
    if (typeof link !== 'string' || link.length > 12000) throw Error('Pegá el enlace del correo de PhotoBatch.');
    let url;
    try { url = new globalThis.URL(link.trim()); } catch { throw Error('Copiá el enlace del botón del correo (clic derecho → Copiar enlace).'); }
    if (url.origin !== URL || url.pathname !== '/auth/v1/verify') throw Error('El enlace no corresponde al proyecto PhotoBatch.');
    const type = url.searchParams.get('type'), token_hash = url.searchParams.get('token') || url.searchParams.get('token_hash');
    if (!['signup','recovery'].includes(type) || !token_hash || !/^[a-zA-Z0-9_-]{16,512}$/.test(token_hash))
      throw Error('Ese enlace no es de confirmación o recuperación de PhotoBatch.');
    if (type === 'recovery') passwordValue(newPassword,true);
    const data = await this.request('/auth/v1/verify',{token_hash,type});
    await this.saveSession(data);
    if (type === 'recovery') await this.authenticated('/auth/v1/user',{password:newPassword},'PUT');
    return this.sync();
  }
  async signOut() {
    // Local scope: the other computer keeps its session. Failure must not leave
    // this device logged in or erase any cloud/local counter.
    try { if (this.session) await this.authenticated('/auth/v1/logout?scope=local',undefined); }
    finally {
      this.session = null; this.online = false; this.counters = null; this.remembered = false;
      this.message = ''; fs.rmSync(this.file,{force:true});
    }
    return this.snapshot();
  }
  acceptCounters(data) {
    this.counters = validCounters(data);
    this.floor = {photo:Math.max(this.floor.photo,data.photo),video:Math.max(this.floor.video,data.video)};
    atomicWrite(this.counterFile,envelope(this.floor));
    this.online = true;
    this.message = this.remembered ? '' : 'La sesión dura hasta cerrar PhotoBatch: el sistema no dispone de almacenamiento seguro.';
    return this.snapshot();
  }
  async sync(next) {
    if (this.floorError) throw Error(this.floorError);
    const local = validCounters(this.localCounters());
    let photo = Math.max(local.photo,this.floor.photo), video = Math.max(local.video,this.floor.video);
    if (next !== undefined) {
      if (!next || !Number.isInteger(next.photo) || !Number.isInteger(next.video) || next.photo<0 || next.video<14099 || next.photo>MAX || next.video>MAX)
        throw Error('Ingresá los próximos números válidos de fotos y videos.');
      photo = Math.max(photo,next.photo-1); video = Math.max(video,next.video-1);
    }
    return this.acceptCounters(await this.authenticated('/rest/v1/rpc/sync_counters',{p_photo:photo,p_video:video}));
  }
  async reserve(kind, start, end, requestId) {
    if (this.floorError) throw Error(this.floorError);
    const data = await this.authenticated('/rest/v1/rpc/reserve_numbers',
      {p_request:requestId,p_kind:kind,p_start:start,p_end:end});
    if (data.start!==start || data.end!==end) throw Error('La reserva no coincide con la tanda.');
    this.acceptCounters(data);
  }
}
module.exports = {Cloud, validCounters, URL, KEY};
