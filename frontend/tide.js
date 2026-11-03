/* ============================================================
   孤岛浪花 · 潮汐模型
   ------------------------------------------------------------
   全站唯一的潮汐真源。

   左栏的潮位仪表、主界面的背景海面，读的都是这里的同一组数：
   五个主要分潮（M2/S2/N2/K1/O1）谐波叠加，得到不等幅的半日潮。
   仪表上的曲线和背景里的浪是同一片海——改一处，两处同时变。

   时间锚点：所有相位都挂在一个固定的历元（2000-01-01 UTC）上，
   而不是「距此刻多少小时」。这样有两个好处：
     · 潮位真的随世界时钟涨落，刷新页面看到的是此刻的潮
     · 同一时刻，所有人看到的都是同一片海
   ============================================================ */
(function (global) {
  'use strict';

  /* 分潮表：名称 / 周期（小时）/ 振幅（米）/ 迟角（度）
     迟角（phase）是这个分潮自己的相位差，决定它与其它分潮
     如何错开。五个分潮周期互不相同，叠在一起就得到真实海岸
     那种「一高一低、涨落不等幅」的形状，而不是规整的正弦。 */
  var TIDES = [
    { name: 'M2', period: 12.4206, amp: 0.62, phase: 32 },   // 主月半日潮（最主要）
    { name: 'S2', period: 12.0000, amp: 0.21, phase: 48 },   // 主太阳半日潮
    { name: 'N2', period: 12.6583, amp: 0.12, phase: 18 },   // 大月椭率半日潮
    { name: 'K1', period: 23.9345, amp: 0.19, phase: 205 },  // 日月赤纬日潮
    { name: 'O1', period: 25.8193, amp: 0.13, phase: 178 }   // 主太阳日潮
  ];

  var MSL = 1.42;   // 平均海平面（米）
  var MIN = 0.0;    // 仪表量程下限（米）
  var MAX = 2.8;    // 仪表量程上限（米）

  /* 历元：2000-01-01 00:00:00 UTC 至今的小时数。
     所有相位都相对于它推算，所以潮位跟着真实世界时钟走。 */
  function epochHours() {
    return (Date.now() - Date.UTC(2000, 0, 1)) / 3600000;
  }

  /* 潮高（米）：t = 距今的小时数，可正可负（负数表示过去） */
  function height(t) {
    var T = epochHours() + t;          // 绝对小时
    var h = MSL;
    for (var i = 0; i < TIDES.length; i++) {
      var c = TIDES[i];
      h += c.amp * Math.cos(2 * Math.PI * (T / c.period) + c.phase * Math.PI / 180);
    }
    return h;
  }

  /* 归一化潮位 0~1：背景海面用它决定浪有多大 */
  function norm(t) {
    var v = (height(t) - MIN) / (MAX - MIN);
    return v < 0 ? 0 : (v > 1 ? 1 : v);
  }

  /* 潮势（厘米/小时）：正数是涨潮，负数是退潮。
     往前看 6 分钟的潮位变化，折算成每小时的厘米数。 */
  function rate(t) {
    return (height((t || 0) + 0.1) - height(t || 0)) * 1000;
  }

  /* 本次潮 cycle 的落差（米）：大潮约 1.8，小潮约 0.6 */
  function range() {
    var hi = -99, lo = 99;
    for (var k = 0; k <= 1440; k += 5) {
      var v = height(k / 60);
      if (v > hi) hi = v;
      if (v < lo) lo = v;
    }
    return hi - lo;
  }

  global.ISLAND_TIDE = {
    TIDES: TIDES,
    MSL: MSL,
    MIN: MIN,
    MAX: MAX,
    height: height,
    norm: norm,
    rate: rate,
    range: range
  };
})(window);
