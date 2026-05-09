const { request } = require("../../utils/request.js");
const { getApiBase } = require("../../utils/config.js");
const { redirectIfNeedJoinClass } = require("../../utils/joinGate.js");

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
      const enriched = {
        ...it,
        file_url_abs: absFileUrl(it.file_url),
        can_dl:
          it.can_system_download === true ||
          it.can_system_download === 1 ||
          it.can_system_download === "1" ||
          it.can_system_download === "true",
      };
      if (i % 2 === 0) left.push(enriched);
      else right.push(enriched);
    });
    return { subject_key: sec.subject_key, subject_name: sec.subject_name, left, right };
  });
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
      const classes = raw.map((c) => ({
        id: Number(c.id),
        name: String(c.name || ""),
        grade: String(c.grade || ""),
        label: `${String(c.name || "")}（${String(c.grade || "-")}）`,
      })).filter((c) => c.id > 0);
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
      const sections = buildSections(list);
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

  onTapCard(e) {
    const ds = e.currentTarget.dataset || {};
    const id = ds.id;
    const fileType = String(ds.ft || "file");
    const url = String(ds.url || "");
    const name = String(ds.name || "");
    const canDl = ds.candl === "1" || ds.candl === 1;
    if (!url) {
      wx.showToast({ title: "无有效文件地址", icon: "none" });
      return;
    }
    const isImg =
      fileType === "image" ||
      /\.(png|jpe?g|gif|webp)(\?|$)/i.test(url);
    if (isImg) {
      wx.previewImage({ urls: [url], current: url });
      return;
    }
    if (fileType === "video" || /\.(mp4|mov|m4v)(\?|$)/i.test(url)) {
      this.setData({ videoPreviewUrl: url, videoPreviewVisible: true });
      return;
    }
    wx.showActionSheet({
      itemList: canDl ? ["下载并打开", "取消"] : ["复制文件链接", "取消"],
      success: (r) => {
        if (r.tapIndex === 0) {
          if (canDl) void this.downloadAndOpen(Number(id), name);
          else {
            wx.setClipboardData({
              data: url,
              success: () => wx.showToast({ title: "链接已复制", icon: "none" }),
            });
          }
        }
      },
    });
  },

  onTapDownload(e) {
    const id = Number(e.currentTarget.dataset.id);
    const name = String(e.currentTarget.dataset.name || "");
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
    void this.downloadAndOpen(id, name);
  },

  downloadAndOpen(resourceId, displayName) {
    const classId = this.data.classId;
    const token = wx.getStorageSync("student_token") || "";
    const base = getApiBase().replace(/\/$/, "");
    const url = `${base}/api/student/resources/${encodeURIComponent(String(resourceId))}/download?class_id=${encodeURIComponent(String(classId))}`;
    wx.showLoading({ title: "下载中", mask: true });
    wx.downloadFile({
      url,
      header: { Authorization: `Bearer ${token}` },
      success: (res) => {
        wx.hideLoading();
        if (res.statusCode !== 200 || !res.tempFilePath) {
          wx.showToast({ title: "下载失败", icon: "none" });
          return;
        }
        wx.openDocument({
          filePath: res.tempFilePath,
          showMenu: true,
          fail: () => {
            wx.showToast({ title: "无法打开该格式，可尝试保存后查看", icon: "none" });
          },
        });
      },
      fail: () => {
        wx.hideLoading();
        wx.showToast({ title: "下载失败", icon: "none" });
      },
    });
  },
});
