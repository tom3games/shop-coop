// 仮の店。店の種類はまだ決めていないので、ここにだけ「この店固有のもの」を書く。
// 共通の仕組み（客・注文・工程・品質・売上・営業の進行・難易度・結果）は shared/sim.js にあり、このファイルの値を読むだけ。
// 別の店にするときは、このファイルを複製して products / stations / layout / options を書き換える。
//
// 座標はメートル。x は右、z は手前（客席側）が正。厨房は z < 0.6、カウンターの向こうが客席。

export const SHOP = {
  id: 'prototype',
  name: '仮の店',

  // 商品。price は基本の値段。make は作り方の説明（遊び方画面とヒントに出す）
  products: {
    bread: { name: '仮パン', price: 300, make: '生地箱で生地を取り、オーブンで焼いて取り出す' },
    drink: { name: '仮ドリンク', price: 150, make: 'カップを取り、ドリンク機に置いて満タンまで待つ' }
  },

  // 持てる物。color は画面の色の目安
  items: {
    dough: { name: '生地' },
    bread: { name: '仮パン' },
    cup: { name: '空のカップ' },
    drink: { name: '仮ドリンク' },
    crate: { name: '材料の箱', cost: 200 } // 生地箱の補充に使う。使うと材料費がかかる
  },

  // タイミング型の工程: オーブン。焼き時間（秒）で品質が決まる
  bake: {
    windows: { normal: [6.5, 9], well: [10.5, 13] }, // ちょうどの範囲
    burnt: 16,       // ここを過ぎると焦げ（品質は低いが渡せる。理不尽にしない）
    lossPerSec: 16   // 範囲から1秒外れるごとに品質がこれだけ下がる
  },
  // 手順型の工程: ドリンク機。置けば勝手にたまる
  brewSec: 3.5,
  // 補充型: 生地箱の在庫
  doughStock: { start: 6, max: 6, maxBig: 10 },

  // 注文の追加条件（店固有）。後半から「よく焼き」の注文が混ざる
  options: {
    well: { label: 'よく焼き', product: 'bread', from: 'peak' }
  },

  // 設備と置き場所。type ごとの動きは sim.js が持つ。upgrade が付いた物は、その改善を買ったときだけ出る
  stations: [
    { id: 'oven1', type: 'oven', x: -5.0, z: -4.3, label: 'オーブン' },
    { id: 'oven2', type: 'oven', x: -3.3, z: -4.3, label: 'オーブン2', upgrade: 'oven2' },
    { id: 'dough', type: 'doughbox', x: -6.25, z: -1.6, label: '生地箱' },
    { id: 'crates', type: 'crates', x: 6.0, z: -4.2, label: '材料の箱' },
    { id: 'drink1', type: 'drinker', x: 2.3, z: -4.3, label: 'ドリンク機' },
    { id: 'cups', type: 'cups', x: 4.0, z: -4.3, label: 'カップ' },
    { id: 'island', type: 'table', x: 0, z: -1.7, w: 3.0, d: 1.1, slots: [[-1.05, 0], [-0.35, 0], [0.35, 0], [1.05, 0]], label: '作業台' },
    { id: 'side', type: 'table', x: -1.6, z: -4.35, w: 1.4, d: 0.8, slots: [[-0.35, 0], [0.35, 0]], label: '台' },
    { id: 'trash', type: 'trash', x: 6.35, z: -0.9, label: 'ゴミ箱' },
    { id: 'register', type: 'register', x: 4.6, z: 1.0, label: 'レジ' }
  ],

  // 店の形
  layout: {
    floor: [-7, -5, 7, 10.5], // x0, z0, x1, z1
    counter: { x0: -7, x1: 3.9, z0: 0.6, z1: 1.4 },
    // 客が注文を出して待つ場所（カウンターの向こう）
    spots: [[-5.2, 2.15], [-3.2, 2.15], [-1.2, 2.15], [0.8, 2.15], [2.8, 2.15]],
    payLine: [[4.6, 2.15], [4.6, 3.1], [4.6, 4.0], [4.6, 4.9], [5.6, 5.6], [5.6, 6.5]],
    door: [0, 10.2],
    queue: [[-0.6, 8.6], [0.6, 8.6], [-0.6, 9.5], [0.6, 9.5]], // 待つ場所が埋まっていたらここで並ぶ
    seats: [[-4.4, 6.9], [-3.0, 6.9], [3.0, 7.4], [-4.4, 8.6], [-3.0, 8.6]], // 店内で食べる客が座る所
    tables: [[-3.7, 7.75, 2.2, 0.9]], // 客席の机（見た目と当たり）
    spawn: [0.8, 0.4], // 店員が出てくる位置（厨房）
    // 店員が歩ける範囲。厨房とレジの脇の通路だけ（客席側には出ない）
    staffArea: [-6.75, -4.75, 6.75, 1.95]
  }
}

// 出店場所。数字は難易度と儲けの違い。上位互換にしない（駅前は客が多いが待ってくれない、住宅街は少ないがよく焼きが多い 等）
export const LOCATIONS = {
  residential: {
    name: '住宅街', lead: '客は少なめ。のんびり作れるが、よく焼きの注文が多い',
    priceMul: 1.0, patienceMul: 1.3, rateMul: 0.8, wellShare: 0.45, eatIn: 0.5
  },
  station: {
    name: '駅前', lead: '客が多く、待ってくれない。値段は高め。持ち帰りが多い',
    priceMul: 1.25, patienceMul: 0.85, rateMul: 1.25, wellShare: 0.2, eatIn: 0.15
  }
}

// 営業の流れ。from は営業開始からの割合（0〜1）。interval は客が来る間隔（秒、2人のとき）。
// 序盤は覚える時間、中盤は同時進行、終盤は殺到。新しい要素は1段ずつ入れる（昼=2品の注文、ピーク=よく焼き）
export const PHASES = [
  { id: 'open', name: '開店', from: 0, interval: 26, maxItems: 1, patience: 95 },
  { id: 'lunch', name: '昼', from: 0.22, interval: 18, maxItems: 2, patience: 85 },
  { id: 'peak', name: 'ピーク', from: 0.55, interval: 12, maxItems: 3, patience: 75 },
  { id: 'close', name: '閉店前', from: 0.92, interval: 0, maxItems: 0, patience: 70 } // 新しい客は来ない。残りを片付ける
]

// 設備の改善。営業で得た利益（店の貯金）で買う。買わなくても遊べる
export const UPGRADES = {
  oven2: { name: 'オーブン2台目', cost: 600, lead: '同時に2つ焼ける' },
  shoes: { name: '早足の靴', cost: 400, lead: '歩く速さが2割上がる' },
  bigbox: { name: '大きい生地箱', cost: 300, lead: '生地を10個まで入れておける' }
}

export const DEFAULT_LOCATION = 'residential'
