const { request } = require("../../utils/request.js");
const { getApiBase } = require("../../utils/config.js");
const studyLocalCache = require("../../utils/studyLocalCache.js");

function absFileUrl(u) {
  const s = String(u || "").trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  const b = getApiBase().replace(/\/$/, "");
  return s.startsWith("/") ? b + s : `${b}/${s}`;
}

function subjectGroupKey(row) {
  const sid = row.subject_id;
  if (sid != null && sid !== "" && !Number.isNaN(Number(sid))) {
    return { key: `id_${Number(sid)}`, name: String(row.subject_name || "").trim() || "未命名科目" };
  }
  const nm = String(row.subject_name || "").trim();
  return { key: `na_${nm || "none"}`, name: nm || "未设置科目" };
}

/** 与 exam-list 等页一致：兼容 { data: [] } 或极少数直连数组 */
function takeArrayFromStudentApi(res) {
  if (res == null) return [];
  if (Array.isArray(res)) return res;
  const d = res.data;
  if (Array.isArray(d)) return d;
  if (d != null && typeof d === "object" && Array.isArray(d.rows)) return d.rows;
  return [];
}

function buildSections(list) {
  const map = new Map();
  for (const row of list) {
    const { key, name } = subjectGroupKey(row);
    if (!map.has(key)) {
      map.set(key, { subject_key: key, subject_name: name, items: [] });
    }
    map.get(key).items.push(row);
  }
  const arr = Array.from(map.values());
  arr.sort((a, b) => {
    const na = a.subject_name;
    const nb = b.subject_name;
    return String(na).localeCompare(String(nb), "zh-Hans-CN");
  });
  return arr.map((sec) => {
    const left = [];
    const right = [];
    sec.items.forEach((it, i) => {
      const canDl =
        it.can_system_download === true ||
        it.can_system_download === 1 ||
        it.can_system_download === "1" ||
        it.can_system_download === "true";
      const turbo = String(it.direct_download_url || "").trim();
      const enriched = {
        ...it,
        file_url_abs: absFileUrl(it.file_url),
        can_dl: canDl,
        /** 与当前 API 同域的直链，优先用于 wx.downloadFile */
        turbo_download_url: turbo || (canDl ? absFileUrl(it.file_url) : ""),
      };
      if (i % 2 === 0) left.push(enriched);
      else right.push(enriched);
    });
    return { subject_key: sec.subject_key, subject_name: sec.subject_name, left, right };
  });
}

function getFileExt(displayName, fileUrl) {
  const n = String(displayName || "").trim();
  if (n.includes(".")) {
    const e = n.slice(n.lastIndexOf(".") + 1).toLowerCase();
    if (e && e.length <= 12 && !/[\\/]/.test(e)) return e;
  }
  const u = String(fileUrl || "").split("?")[0];
  const last = u.split("/").pop() || "";
  if (last.includes(".")) {
    const e = last.slice(last.lastIndexOf(".") + 1).toLowerCase();
    if (e && e.length <= 12) return e;
  }
  return "";
}

function isAudioExt(ext) {
  return ["mp3", "m4a", "aac", "wav", "flac", "ogg"].includes(String(ext || "").toLowerCase());
}

function isImageExt(ext) {
  return ["png", "jpg", "jpeg", "gif", "webp", "bmp"].includes(String(ext || "").toLowerCase());
}

function isImageResource(fileType, displayName, fileUrl) {
  const ft = String(fileType || "").toLowerCase();
  if (ft === "image") return true;
  const ext = getFileExt(displayName, fileUrl);
  if (isImageExt(ext)) return true;
  return /\.(png|jpe?g|gif|webp|bmp)(\?|$)/i.test(String(fileUrl || ""));
}

function friendlyOpenFailMsg(errMsg, fallback) {
  const em = String(errMsg || "");
  if (/filetype not supported/i.test(em)) return "该格式无法在小程序内直接打开";
  if (/openDocument/i.test(em)) return fallback || "无法打开文件";
  if (/previewImage/i.test(em)) return fallback || "无法预览图片";
  return em || fallback || "无法打开";
}

/** wx.openDocument 的 fileType，缺省时由基础库按扩展名推断 */
function mapOpenDocumentFileType(ext) {
  const e = String(ext || "").toLowerCase();
  const map = {
    pdf: "pdf",
    doc: "doc",
    docx: "docx",
    xls: "xls",
    xlsx: "xlsx",
    ppt: "ppt",
    pptx: "pptx",
  };
  return map[e] || undefined;
}

function parseUrlHost(u) {
  const m = String(u || "").match(/^https?:\/\/([^/?#]+)/i);
  return m ? String(m[1]).toLowerCase() : "";
}

/**
 * 本地上传的资料 file_url 指向 /uploads/，可由静态服务直出。
 * 直链 wx.downloadFile 不走 Node 鉴权接口，明显更快；失败再回退 API。
 * http 仅允许本机调试或与 api_base 同 Host（内网 http 联调）。
 */
function canUseDirectStudyDownload(fileUrlAbs) {
  const s = String(fileUrlAbs || "").trim();
  if (!s || /\.\./.test(s)) return false;
  if (!/\/uploads\//i.test(s)) return false;
  const isHttps = /^https:\/\//i.test(s);
  const isLocalHttp = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(s);
  if (isHttps || isLocalHttp) return true;
  const isHttp = /^http:\/\//i.test(s);
  if (isHttp) {
    const h1 = parseUrlHost(s);
    const h2 = parseUrlHost(getApiBase());
    return Boolean(h1 && h2 && h1 === h2);
  }
  return false;
}

Page({
  data: {
    loggedIn: false,
    loadError: "",
    /** null 表示尚未拉取班级列表 */
    classes: null,
    classIndex: 0,
    classId: null,
    currentClassLabel: "",
    sections: [],
    resourcesEmpty: true,
    resourcesLoading: false,
    videoPreviewUrl: "",
    videoPreviewVisible: false,
    audioPreviewVisible: false,
    audioPreviewName: "",
    audioPlaying: false,
  },

  onLoad() {
    this._audioPlayEpoch = 0;
    this._audioSuppressErrorUntil = 0;
    this._audioCurrentResourceId = 0;
    this._audioCtx = wx.createInnerAudioContext();
    this._audioCtx.onPlay(() => {
      this._suppressInnerAudioErrors(250);
      this.setData({ audioPlaying: true });
    });
    this._audioCtx.onPause(() => this.setData({ audioPlaying: false }));
    this._audioCtx.onStop(() => this.setData({ audioPlaying: false }));
    this._audioCtx.onEnded(() => this.setData({ audioPlaying: false }));
    this._audioCtx.onError((res) => this._onInnerAudioError(res));
  },

  /** 在 stop/destroy/切歌 前后短暂屏蔽 onError，避免误报「音频播放失败」 */
  _suppressInnerAudioErrors(ms) {
    this._audioSuppressErrorUntil = Math.max(this._audioSuppressErrorUntil || 0, Date.now() + (ms || 500));
  },

  _onInnerAudioError(res) {
    if (Date.now() < (this._audioSuppressErrorUntil || 0)) return;
    if (!this.data.audioPreviewVisible) return;
    const errMsg = String((res && res.errMsg) || "");
    if (/abort|interrupt|cancel|stop|seek|pause/i.test(errMsg)) return;
    const code = Number((res && res.errCode) != null ? res.errCode : NaN);
    const cid = this.data.classId;
    const rid = Number(this._audioCurrentResourceId) || 0;
    if (code === 10003 && cid && rid > 0) {
      studyLocalCache.removeRecord(cid, rid);
      this.refreshSectionsLocalFlags();
    }
    let title = "音频播放失败";
    if (code === 10003) title = "文件无法播放，已清除本地缓存，请重新下载";
    else if (code === 10004) title = "该音频格式本机无法解码，请换 MP3 等常见格式";
    else if (code === 10002) title = "网络异常，请检查网络后重试";
    else if (code === 10001) title = "播放异常，请稍后重试";
    try {
      console.warn("[study audio]", code, errMsg);
    } catch (_) {}
    this.setData({ audioPlaying: false });
    wx.showToast({ title, icon: "none" });
  },

  /**
   * 停止当前播放后设置新地址并播放；用 epoch + nextTick 减轻切歌/停止触发的误报 onError。
   */
  _playLocalAudioFile(localPath, resourceId, displayName) {
    if (!this._audioCtx || !String(localPath || "").trim()) return;
    this._audioPlayEpoch = (this._audioPlayEpoch || 0) + 1;
    const epoch = this._audioPlayEpoch;
    this._suppressInnerAudioErrors(700);
    try {
      this._audioCtx.stop();
    } catch (_) {}
    this._audioCurrentResourceId = Number(resourceId) > 0 ? Number(resourceId) : 0;
    this._audioCtx.src = localPath;
    this.setData({
      audioPreviewVisible: true,
      audioPreviewName: displayName || "音频",
    });
    const run = () => {
      if (!this._audioCtx || this._audioPlayEpoch !== epoch) return;
      try {
        this._audioCtx.play();
      } catch (e) {
        try {
          console.warn("[study audio] play()", e);
        } catch (_) {}
        wx.showToast({ title: "无法开始播放", icon: "none" });
      }
    };
    if (typeof wx.nextTick === "function") wx.nextTick(run);
    else setTimeout(run, 50);
  },

  onHide() {
    this.closeAudioPreview();
  },

  onUnload() {
    this.closeAudioPreview();
    if (this._audioCtx) {
      this._suppressInnerAudioErrors(2000);
      try {
        this._audioCtx.destroy();
      } catch (_) {}
      this._audioCtx = null;
    }
  },

  onShow() {
    if (typeof this.getTabBar === "function" && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2 });
    }
    const token = wx.getStorageSync("student_token");
    this.setData({ loggedIn: Boolean(token) });
    if (!token) {
      this.setData({
        classes: [],
        classId: null,
        currentClassLabel: "",
        sections: [],
        resourcesEmpty: true,
        resourcesLoading: false,
        loadError: "",
      });
      return;
    }
    if (this.data.classId && Array.isArray(this.data.sections) && this.data.sections.length > 0) {
      this.refreshSectionsLocalFlags();
    }
    void this.bootstrap();
  },

  goLogin() {
    wx.navigateTo({ url: "/pages/login/index" });
  },

  onPullDownRefresh() {
    void this.loadResources().finally(() => {
      try {
        wx.stopPullDownRefresh();
      } catch (_) {}
    });
  },

  noop() {},

  async bootstrap() {
    this.setData({ loadError: "" });
    wx.showLoading({ title: "加载中", mask: true });
    try {
      const res = await request({ path: "/api/student/my-classes", method: "GET" });
      const raw = takeArrayFromStudentApi(res);
      const classes = raw.map((c) => {
        const name = String(c.name || "").trim();
        return {
          id: Number(c.id),
          name,
          label: name || "班级",
        };
      }).filter((c) => c.id > 0);
      if (classes.length === 0) {
        this.setData({
          classes: [],
          classId: null,
          currentClassLabel: "",
          sections: [],
          resourcesEmpty: true,
          resourcesLoading: false,
          loadError: "未加入班级暂无数据",
        });
        wx.hideLoading();
        return;
      }
      let saved = wx.getStorageSync("study_class_id");
      let idx = classes.findIndex((c) => Number(c.id) === Number(saved));
      if (idx < 0) idx = 0;
      const picked = classes[idx];
      wx.setStorageSync("study_class_id", picked.id);
      this.setData({
        classes,
        classIndex: idx,
        classId: picked.id,
        currentClassLabel: picked.label,
        resourcesLoading: true,
      });
      await this.loadResources();
    } catch (e) {
      const msg = (e && e.message) || "加载失败";
      this.setData({
        classes: [],
        loadError: msg,
        sections: [],
        resourcesEmpty: true,
        resourcesLoading: false,
      });
      wx.showToast({ title: msg, icon: "none" });
    } finally {
      try {
        wx.hideLoading();
      } catch (_) {}
    }
  },

  onClassPick(e) {
    const idx = Number(e.detail.value);
    const c = this.data.classes[idx];
    if (!c) return;
    wx.setStorageSync("study_class_id", c.id);
    this.setData({
      classIndex: idx,
      classId: c.id,
      currentClassLabel: c.label,
      resourcesLoading: true,
    });
    void this.loadResources();
  },

  async loadResources() {
    const classId = this.data.classId;
    if (!classId) {
      this.setData({ sections: [], resourcesEmpty: true, resourcesLoading: false });
      return;
    }
    this.setData({ resourcesLoading: true });
    try {
      wx.showNavigationBarLoading();
    } catch (_) {}
    try {
      const res = await request({
        path: `/api/student/resources?class_id=${encodeURIComponent(String(classId))}`,
        method: "GET",
      });
      const list = takeArrayFromStudentApi(res);
      const sections = studyLocalCache.mergeLocalSavedFlag(classId, buildSections(list));
      this.setData({
        sections,
        resourcesEmpty: list.length === 0,
        resourcesLoading: false,
        loadError: "",
      });
    } catch (e) {
      const msg = (e && e.message) || "资料加载失败";
      this.setData({
        loadError: msg,
        sections: [],
        resourcesEmpty: true,
        resourcesLoading: false,
      });
      wx.showToast({ title: msg, icon: "none" });
    } finally {
      try {
        wx.hideNavigationBarLoading();
      } catch (_) {}
    }
  },

  closeVideoPreview() {
    this.setData({ videoPreviewVisible: false, videoPreviewUrl: "" });
  },

  closeAudioPreview() {
    this._suppressInnerAudioErrors(500);
    this._audioPlayEpoch = (this._audioPlayEpoch || 0) + 1;
    this._audioCurrentResourceId = 0;
    if (this.data.audioPreviewVisible) {
      this.setData({ audioPreviewVisible: false, audioPreviewName: "", audioPlaying: false });
    }
    if (this._audioCtx) {
      try {
        this._audioCtx.stop();
      } catch (_) {}
    }
  },

  toggleAudioPreview() {
    if (!this._audioCtx) return;
    if (this.data.audioPlaying) {
      this._audioCtx.pause();
      return;
    }
    if (!String(this._audioCtx.src || "").trim()) {
      wx.showToast({ title: "请先选择一条音频资料", icon: "none" });
      return;
    }
    try {
      this._audioCtx.play();
    } catch (e) {
      this._onInnerAudioError({ errCode: 10001, errMsg: String((e && e.message) || "") });
    }
  },

  refreshSectionsLocalFlags() {
    const cid = this.data.classId;
    const sections = this.data.sections;
    if (!cid || !Array.isArray(sections) || sections.length === 0) return;
    this.setData({ sections: studyLocalCache.mergeLocalSavedFlag(cid, sections) });
  },

  /** 下载成功后写入本地记录并刷新「已下载」标注 */
  async markResourceDownloaded(resourceId, localPath, displayName) {
    const cid = this.data.classId;
    if (!cid || !Number.isFinite(resourceId) || resourceId <= 0) return localPath;
    let saved = localPath;
    try {
      saved = await studyLocalCache.saveDownloadRecord(cid, resourceId, localPath, displayName);
    } catch (e) {
      console.warn("[study] saveDownloadRecord failed", e);
    }
    this.refreshSectionsLocalFlags();
    return saved;
  },

  /**
   * 若 Storage 中有持久路径且文件仍在，则直接打开（文档 openDocument / 音频播放器）。
   * @returns {Promise<boolean>} 是否已成功从本地打开
   */
  async tryOpenSavedLocalFile(resourceId, displayName, fileType, fileUrl, isAudio) {
    const cid = this.data.classId;
    const rec = studyLocalCache.getRecord(cid, resourceId);
    if (!rec || !rec.path) return false;
    const ok = await studyLocalCache.checkPathUsable(rec.path);
    if (!ok) {
      studyLocalCache.removeRecord(cid, resourceId);
      this.refreshSectionsLocalFlags();
      return false;
    }
    if (isAudio) {
      this.closeVideoPreview();
      if (!this._audioCtx) return false;
      this._playLocalAudioFile(rec.path, resourceId, displayName || "音频");
      return true;
    }
    if (isImageResource(fileType, displayName || rec.name, fileUrl)) {
      this.closeAudioPreview();
      this.closeVideoPreview();
      this.previewImageFromPath(rec.path, "无法预览图片", resourceId);
      return true;
    }
    this.closeAudioPreview();
    this.closeVideoPreview();
    this.openDocumentFromTemp(rec.path, displayName, "无法从本地打开", resourceId);
    return true;
  },

  /**
   * @param {boolean} silent 为 true 时不 Toast（直链失败时静默换 API）
   */
  runWxDownloadOnce(url, header, displayName, resourceKey, loadingTitle, silent) {
    const ext = getFileExt(displayName, "");
    const safeExt = ext && /^[a-z0-9]+$/i.test(ext) ? String(ext).toLowerCase() : "";
    let userPath = "";
    try {
      userPath = wx.env && wx.env.USER_DATA_PATH ? String(wx.env.USER_DATA_PATH) : "";
    } catch (_) {
      userPath = "";
    }
    const canFilePath =
      Boolean(userPath && safeExt) &&
      (typeof wx.canIUse !== "function" || wx.canIUse("downloadFile.object.filePath"));
    const filePath = canFilePath
      ? `${userPath}/qw_res_${resourceKey}_${Date.now()}.${safeExt}`
      : undefined;
    const baseTitle = String(loadingTitle || "加载中").replace(/…$/, "");
    wx.showLoading({ title: loadingTitle || "加载中", mask: true });
    return new Promise((resolve, reject) => {
      const opts = {
        url,
        header: header || {},
        success: async (res) => {
          wx.hideLoading();
          const path = res.filePath || res.tempFilePath;
          if (!path) {
            if (!silent) wx.showToast({ title: "文件获取失败", icon: "none" });
            reject(new Error("nopath"));
            return;
          }
          const sc = res.statusCode;
          if (sc !== undefined && sc !== 200) {
            if (!silent) {
              wx.showToast({
                title: `请求失败(${sc})`,
                icon: "none",
              });
            }
            reject(new Error("http"));
            return;
          }
          resolve(path);
        },
        fail: (err) => {
          wx.hideLoading();
          if (!silent) {
            const em = (err && err.errMsg) || "";
            wx.showToast({ title: em ? em.slice(0, 40) : "网络失败", icon: "none" });
          }
          reject(new Error("net"));
        },
      };
      if (filePath) opts.filePath = filePath;
      const task = wx.downloadFile(opts);
      if (task && typeof task.onProgressUpdate === "function") {
        let lastPct = -10;
        task.onProgressUpdate((ev) => {
          const tot = ev.totalBytesExpectedToWrite;
          const cur = ev.totalBytesWritten;
          if (!tot || tot <= 0) return;
          const pct = Math.min(99, Math.floor((100 * cur) / tot));
          if (pct < lastPct + 5 && pct < 99) return;
          lastPct = pct;
          try {
            wx.showLoading({ title: `${baseTitle} ${pct}%`, mask: true });
          } catch (_) {}
        });
      }
    });
  },

  _downloadResourceViaApi(resourceId, displayName, loadingTitle) {
    const classId = this.data.classId;
    const token = wx.getStorageSync("student_token") || "";
    const base = getApiBase().replace(/\/$/, "");
    const q = [
      `class_id=${encodeURIComponent(String(classId))}`,
      token ? `access_token=${encodeURIComponent(token)}` : "",
    ]
      .filter(Boolean)
      .join("&");
    const url = `${base}/api/student/resources/${encodeURIComponent(String(resourceId))}/download?${q}`;
    return this.runWxDownloadOnce(
      url,
      token ? { Authorization: `Bearer ${token}` } : {},
      displayName,
      resourceId,
      loadingTitle,
      false,
    );
  },

  /** @param {string} [turboUrl] 优先服务端下发的 direct_download_url，与 api 同域 */
  downloadResourceToTemp(resourceId, displayName, loadingTitle, turboUrl) {
    const classId = this.data.classId;
    if (!classId || !Number.isFinite(resourceId) || resourceId <= 0) {
      wx.showToast({ title: "无法打开", icon: "none" });
      return Promise.reject(new Error("bad"));
    }
    const abs = String(turboUrl || "").trim();
    if (canUseDirectStudyDownload(abs)) {
      return this.runWxDownloadOnce(abs, {}, displayName, resourceId, loadingTitle, true).catch(() =>
        this._downloadResourceViaApi(resourceId, displayName, loadingTitle),
      );
    }
    return this._downloadResourceViaApi(resourceId, displayName, loadingTitle);
  },

  previewImageFromPath(localPath, failHint, resourceId) {
    const rid = resourceId != null && resourceId !== "" ? Number(resourceId) : NaN;
    wx.previewImage({
      urls: [localPath],
      current: localPath,
      fail: (err) => {
        const em = friendlyOpenFailMsg((err && err.errMsg) || "", failHint);
        if (Number.isFinite(rid) && rid > 0 && this.data.classId) {
          studyLocalCache.removeRecord(this.data.classId, rid);
          this.refreshSectionsLocalFlags();
        }
        wx.showToast({
          title: em.length > 44 ? `${em.slice(0, 42)}…` : em,
          icon: "none",
        });
      },
    });
  },

  openDocumentFromTemp(tempFilePath, displayName, failHint, resourceId, fileUrl) {
    const ext = getFileExt(displayName, fileUrl || "").toLowerCase();
    if (isImageExt(ext)) {
      this.previewImageFromPath(tempFilePath, failHint, resourceId);
      return;
    }
    const mapped = mapOpenDocumentFileType(ext);
    const rid = resourceId != null && resourceId !== "" ? Number(resourceId) : NaN;
    const tip = (msg) => {
      const t = friendlyOpenFailMsg(msg, failHint || "无法打开");
      wx.showToast({ title: t.length > 44 ? `${t.slice(0, 42)}…` : t, icon: "none" });
    };
    const run = (withMappedType) => {
      wx.openDocument({
        filePath: tempFilePath,
        ...(withMappedType && mapped ? { fileType: mapped } : {}),
        showMenu: true,
        success: () => {},
        fail: (err) => {
          const em = (err && err.errMsg) || "";
          if (!withMappedType && mapped) {
            setTimeout(() => run(true), 80);
            return;
          }
          if (Number.isFinite(rid) && rid > 0 && this.data.classId) {
            studyLocalCache.removeRecord(this.data.classId, rid);
            this.refreshSectionsLocalFlags();
          }
          tip(em);
        },
      });
    };
    setTimeout(() => run(false), 100);
  },

  ensureDownloadDisplayName(displayName, fileUrl, fileType) {
    const name = String(displayName || "").trim() || "资料";
    if (getFileExt(name, fileUrl)) return name;
    if (isImageResource(fileType, name, fileUrl)) {
      const ext = getFileExt("", fileUrl) || "png";
      return `${name}.${ext}`;
    }
    return name;
  },

  async openImageFromResource(id, displayName, turboUrl, fileUrl) {
    this.closeAudioPreview();
    this.closeVideoPreview();
    const dlName = this.ensureDownloadDisplayName(displayName, fileUrl, "image");
    if (await this.tryOpenSavedLocalFile(id, dlName, "image", fileUrl, false)) return;
    try {
      const p = await this.downloadResourceToTemp(id, dlName, "正在下载…", turboUrl);
      const saved = await this.markResourceDownloaded(id, p, dlName);
      this.previewImageFromPath(saved, "无法预览图片", id);
    } catch (_) {}
  },

  async openDocPreviewFromResource(id, displayName, turboUrl) {
    this.closeAudioPreview();
    this.closeVideoPreview();
    if (await this.tryOpenSavedLocalFile(id, displayName, "file", "", false)) return;
    try {
      const p = await this.downloadResourceToTemp(id, displayName, "正在打开…", turboUrl);
      const saved = await this.markResourceDownloaded(id, p, displayName);
      this.openDocumentFromTemp(saved, displayName, "无法预览，可点「下载」重试", id, turboUrl);
    } catch (_) {}
  },

  async openAudioPreviewFromResource(id, displayName, turboUrl) {
    this.closeVideoPreview();
    if (await this.tryOpenSavedLocalFile(id, displayName, "audio", "", true)) return;
    try {
      const p = await this.downloadResourceToTemp(id, displayName, "正在加载…", turboUrl);
      const saved = await this.markResourceDownloaded(id, p, displayName);
      if (!this._audioCtx) return;
      this._playLocalAudioFile(saved, id, displayName || "音频");
    } catch (_) {}
  },

  onTapCard(e) {
    const ds = e.currentTarget.dataset || {};
    const id = Number(ds.id);
    const fileType = String(ds.ft || "file");
    const url = String(ds.url || "");
    const turbo = String(ds.turbo || "").trim() || url;
    const name = String(ds.name || "");
    const canDl = ds.candl === "1" || ds.candl === 1;
    if (!url) {
      wx.showToast({ title: "无有效文件地址", icon: "none" });
      return;
    }
    this.closeAudioPreview();
    if (isImageResource(fileType, name, url)) {
      this.closeVideoPreview();
      wx.previewImage({ urls: [url], current: url });
      return;
    }
    if (fileType === "video" || /\.(mp4|mov|m4v)(\?|$)/i.test(url)) {
      this.setData({ videoPreviewUrl: url, videoPreviewVisible: true });
      return;
    }
    if (canDl) {
      if (!Number.isFinite(id) || id <= 0) {
        wx.showToast({ title: "资料无效", icon: "none" });
        return;
      }
      const ext = getFileExt(name, url);
      if (isAudioExt(ext) || fileType === "audio") {
        void this.openAudioPreviewFromResource(id, name, turbo);
        return;
      }
      void this.openDocPreviewFromResource(id, name, turbo);
      return;
    }
    wx.showActionSheet({
      itemList: ["复制文件链接", "取消"],
      success: (r) => {
        if (r.tapIndex === 0) {
          wx.setClipboardData({
            data: url,
            success: () => wx.showToast({ title: "链接已复制", icon: "none" }),
          });
        }
      },
    });
  },

  onTapDownload(e) {
    this.closeAudioPreview();
    const id = Number(e.currentTarget.dataset.id);
    const name = String(e.currentTarget.dataset.name || "");
    const urlHint = String(e.currentTarget.dataset.url || "");
    const ft = String(e.currentTarget.dataset.ft || "");
    const localSaved = e.currentTarget.dataset.local === "1" || e.currentTarget.dataset.local === 1;
    const canDl = e.currentTarget.dataset.candl === "1" || e.currentTarget.dataset.candl === 1;
    if (!canDl) {
      const url = String(e.currentTarget.dataset.url || "");
      if (url) {
        wx.setClipboardData({
          data: url,
          success: () => wx.showToast({ title: "链接已复制", icon: "none" }),
        });
      } else wx.showToast({ title: "该文件不支持小程序内下载", icon: "none" });
      return;
    }
    if (!Number.isFinite(id) || id <= 0) {
      wx.showToast({ title: "资料无效", icon: "none" });
      return;
    }
    const turbo = String(e.currentTarget.dataset.turbo || "").trim() || urlHint;
    const ext = getFileExt(name, urlHint);
    const isAudio = isAudioExt(ext) || ft === "audio";
    const isImg = isImageResource(ft, name, urlHint);
    if (localSaved) {
      void this.tryOpenSavedLocalFile(id, name, ft, urlHint, isAudio).then((opened) => {
        if (!opened) wx.showToast({ title: "本地文件已失效，请重新下载", icon: "none" });
      });
      return;
    }
    if (isAudio) {
      void this.openAudioPreviewFromResource(id, name, turbo);
      return;
    }
    if (isImg) {
      void this.openImageFromResource(id, name, turbo, urlHint);
      return;
    }
    void this.downloadAndOpen(id, name, turbo, urlHint);
  },

  downloadAndOpen(resourceId, displayName, turboUrl, fileUrl) {
    this.closeVideoPreview();
    void this.downloadResourceToTemp(resourceId, displayName, "正在保存…", turboUrl)
      .then(async (p) => {
        const saved = await this.markResourceDownloaded(resourceId, p, displayName);
        this.openDocumentFromTemp(
          saved,
          displayName,
          "无法打开该格式，可尝试保存后查看",
          resourceId,
          fileUrl,
        );
      })
      .catch(() => {});
  },
});
