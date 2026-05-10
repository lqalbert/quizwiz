const { request } = require("../../utils/request.js");
const { getApiBase } = require("../../utils/config.js");
const { redirectIfNeedJoinClass } = require("../../utils/joinGate.js");
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
    this._audioCtx = wx.createInnerAudioContext();
    this._audioCtx.onPlay(() => this.setData({ audioPlaying: true }));
    this._audioCtx.onPause(() => this.setData({ audioPlaying: false }));
    this._audioCtx.onStop(() => this.setData({ audioPlaying: false }));
    this._audioCtx.onEnded(() => this.setData({ audioPlaying: false }));
    this._audioCtx.onError(() => {
      wx.showToast({ title: "音频播放失败", icon: "none" });
    });
  },

  onHide() {
    this.closeAudioPreview();
  },

  onUnload() {
    this.closeAudioPreview();
    if (this._audioCtx) {
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
    if (redirectIfNeedJoinClass()) return;
    if (!wx.getStorageSync("student_token")) {
      wx.reLaunch({ url: "/pages/login/index" });
      return;
    }
    void this.bootstrap();
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
        const name = String(c.name || "");
        const grade = String(c.grade || "").trim();
        return {
          id: Number(c.id),
          name,
          grade,
          label: grade ? `${name}（${grade}）` : name,
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
          loadError: "",
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
    if (this._audioCtx) {
      try {
        this._audioCtx.stop();
      } catch (_) {}
    }
    if (this.data.audioPreviewVisible) {
      this.setData({ audioPreviewVisible: false, audioPreviewName: "", audioPlaying: false });
    }
  },

  toggleAudioPreview() {
    if (!this._audioCtx) return;
    if (this.data.audioPlaying) this._audioCtx.pause();
    else this._audioCtx.play();
  },

  refreshSectionsLocalFlags() {
    const cid = this.data.classId;
    const sections = this.data.sections;
    if (!cid || !Array.isArray(sections) || sections.length === 0) return;
    this.setData({ sections: studyLocalCache.mergeLocalSavedFlag(cid, sections) });
  },

  /**
   * 若 Storage 中有持久路径且文件仍在，则直接打开（文档 openDocument / 音频播放器）。
   * @returns {Promise<boolean>} 是否已成功从本地打开
   */
  async tryOpenSavedOfficeOrAudioFile(resourceId, displayName, isAudio) {
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
      this._audioCtx.stop();
      this._audioCtx.src = rec.path;
      this.setData({
        audioPreviewVisible: true,
        audioPreviewName: displayName || "音频",
      });
      this._audioCtx.play();
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

  openDocumentFromTemp(tempFilePath, displayName, failHint, resourceId) {
    const ext = getFileExt(displayName, "").toLowerCase();
    const mapped = mapOpenDocumentFileType(ext);
    const rid = resourceId != null && resourceId !== "" ? Number(resourceId) : NaN;
    const tip = (msg) => {
      const t = String(msg || failHint || "无法打开");
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
          tip(em || failHint);
        },
      });
    };
    setTimeout(() => run(false), 100);
  },

  async openDocPreviewFromResource(id, displayName, turboUrl) {
    this.closeAudioPreview();
    this.closeVideoPreview();
    if (await this.tryOpenSavedOfficeOrAudioFile(id, displayName, false)) return;
    try {
      const p = await this.downloadResourceToTemp(id, displayName, "正在打开…", turboUrl);
      studyLocalCache.setRecord(this.data.classId, id, p, displayName);
      this.refreshSectionsLocalFlags();
      this.openDocumentFromTemp(p, displayName, "无法预览，可点「下载」重试", id);
    } catch (_) {}
  },

  async openAudioPreviewFromResource(id, displayName, turboUrl) {
    this.closeVideoPreview();
    if (await this.tryOpenSavedOfficeOrAudioFile(id, displayName, true)) return;
    try {
      const p = await this.downloadResourceToTemp(id, displayName, "正在加载…", turboUrl);
      studyLocalCache.setRecord(this.data.classId, id, p, displayName);
      this.refreshSectionsLocalFlags();
      if (!this._audioCtx) return;
      this._audioCtx.stop();
      this._audioCtx.src = p;
      this.setData({
        audioPreviewVisible: true,
        audioPreviewName: displayName || "音频",
      });
      this._audioCtx.play();
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
    const ext = getFileExt(name, url);
    const isImg =
      fileType === "image" ||
      /\.(png|jpe?g|gif|webp)(\?|$)/i.test(url);
    if (isImg) {
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
      if (isAudioExt(ext)) {
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
    if (localSaved) {
      void this.tryOpenSavedOfficeOrAudioFile(id, name, isAudio).then((opened) => {
        if (!opened) wx.showToast({ title: "本地文件已失效，请重新下载", icon: "none" });
      });
      return;
    }
    if (isAudio) {
      void this.openAudioPreviewFromResource(id, name, turbo);
      return;
    }
    void this.downloadAndOpen(id, name, turbo);
  },

  downloadAndOpen(resourceId, displayName, turboUrl) {
    this.closeVideoPreview();
    void this.downloadResourceToTemp(resourceId, displayName, "正在保存…", turboUrl)
      .then((p) => {
        studyLocalCache.setRecord(this.data.classId, resourceId, p, displayName);
        this.refreshSectionsLocalFlags();
        this.openDocumentFromTemp(p, displayName, "无法打开该格式，可尝试保存后查看", resourceId);
      })
      .catch(() => {});
  },
});
