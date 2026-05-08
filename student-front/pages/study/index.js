Page({
  data: {
    items: [
      { id: "1", title: "代数运算", sub: "进度 20 / 38" },
      { id: "2", title: "函数与图像", sub: "进度 14 / 32" },
      { id: "3", title: "几何基础", sub: "进度 12 / 30" },
      { id: "4", title: "概率统计", sub: "进度 16 / 36" },
    ],
  },

  onShow() {
    if (typeof this.getTabBar === "function" && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2 });
    }
  },

  openItem() {},
});
