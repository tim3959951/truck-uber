import type { CargoType, Customer, Driver, HistoryItem, LoadMode, Location, Tier, VehicleClass } from './types';

export const LOCATIONS: Location[] = [
  { id: 'ty', name: '觀音工業區', addr: '桃園市觀音區工業二路 88 號', lat: 25.0405, lng: 121.0942 },
  { id: 'hc', name: '湖口工業區', addr: '新竹縣湖口鄉光復北路 12 號', lat: 24.8905, lng: 121.0433 },
  { id: 'tcp', name: '台中港區 倉儲', addr: '台中市梧棲區臨港路四段 2 號', lat: 24.2802, lng: 120.5265 },
  { id: 'ty2', name: '大雅 廠房', addr: '台中市大雅區中清路四段 300 號', lat: 24.2311, lng: 120.6489 },
  { id: 'ch', name: '員林 建材行', addr: '彰化縣員林市中山路二段 55 號', lat: 23.9583, lng: 120.5744 },
  { id: 'yl', name: '斗六 農場', addr: '雲林縣斗六市雲林路二段 500 號', lat: 23.7081, lng: 120.5418 },
  { id: 'tn', name: '新市 科學園區', addr: '台南市新市區南科三路 9 號', lat: 23.0823, lng: 120.2915 },
  { id: 'kh', name: '岡山 五金廠', addr: '高雄市岡山區本工路 68 號', lat: 22.7977, lng: 120.3012 },
  { id: 'kh2', name: '前鎮 加工出口區', addr: '高雄市前鎮區中山三路 1 號', lat: 22.6053, lng: 120.3141 },
];

export const CARGO_TYPES: CargoType[] = [
  { id: 'soil', name: '培養土 / 肥料', hint: '怕雨淋，建議帆布' },
  { id: 'build', name: '建材 / 磚水泥', hint: '重物，注意配重' },
  { id: 'steel', name: '鋼材 / 金屬', hint: '需綁固' },
  { id: 'mach', name: '機械設備', hint: '精密，避免碰撞' },
  { id: 'agri', name: '農產品', hint: '保持通風' },
  { id: 'box', name: '紙箱雜貨', hint: '可堆疊' },
];

export const TIERS: Tier[] = [
  { id: 'dedicated', name: '專車', desc: '立即派最近的空車，整車專屬', factor: 1.0, eta: '接單後依司機位置估算抵達時間' },
  { id: 'backhaul', name: '回頭車', desc: '順路回程車，價格較低、要等有順路的車', factor: 0.75, eta: '等候時間視順路車而定' },
];

export const MOCK_DRIVER: Driver = {
  id: 'drv_1',
  name: '陳建宏',
  initials: '陳',
  rating: 4.9,
  trips: 1284,
  plate: 'KEA-5177',
  truck: 'HINO 700 · 17噸 大貨車',
  color: '白色',
  phone: '0988-123-456',
};

export const MOCK_CUSTOMER: Customer = {
  id: 'cus_1',
  company: '大明園藝資材行',
  contact: '王先生',
  phone: '0912-345-678',
};

export const MOCK_HISTORY: HistoryItem[] = [
  { id: 'TK-2411', orderNo: 'TK-2411', date: '9/8', from: '觀音工業區', to: '員林 建材行', fromLoc: LOCATIONS[0], toLoc: LOCATIONS[4], pallets: 12, cargo: '建材 / 磚水泥', total: 6980, driverAmount: 5933, status: 'completed' },
  { id: 'TK-2398', orderNo: 'TK-2398', date: '9/5', from: '觀音工業區', to: '新市 科學園區', fromLoc: LOCATIONS[0], toLoc: LOCATIONS[6], pallets: 6, cargo: '機械設備', total: 9740, driverAmount: 8279, status: 'completed' },
];

/** placeholder until the customer picks a place; map falls back to the middle of Taiwan */
export const UNSET_PICKUP: Location = { id: 'unset', name: '選擇裝貨地點', addr: '', lat: 24.15, lng: 120.9 };
export const UNSET_DROP: Location = { id: 'unset', name: '選擇卸貨地點', addr: '', lat: 24.15, lng: 120.9 };
export const isSet = (l: Location) => l.id !== 'unset';

/** distinct places from past orders, most recent first (both ends of each trip) */
export function recentPlaces(history: HistoryItem[], limit = 6): Location[] {
  const out: Location[] = [];
  const seen = new Set<string>();
  for (const h of history) {
    for (const l of [h.fromLoc, h.toLoc]) {
      if (!l || !isSet(l) || seen.has(l.name)) continue;
      seen.add(l.name);
      out.push({ ...l, id: `recent-${out.length}` });
      if (out.length >= limit) return out;
    }
  }
  return out;
}
/** places used most often (ties → most recent) */
export function frequentPlaces(history: HistoryItem[], limit = 3): Location[] {
  const count = new Map<string, { l: Location; n: number }>();
  history.forEach((h) => [h.fromLoc, h.toLoc].forEach((l) => {
    if (!l || !isSet(l)) return;
    const e = count.get(l.name);
    if (e) e.n += 1; else count.set(l.name, { l, n: 1 });
  }));
  return [...count.values()].filter((e) => e.n >= 2).sort((a, b) => b.n - a.n).slice(0, limit).map((e, i) => ({ ...e.l, id: `freq-${i}` }));
}

export const locationById = (id: string) => LOCATIONS.find((l) => l.id === id) ?? LOCATIONS[0];
export const cargoById = (id: string) => CARGO_TYPES.find((c) => c.id === id) ?? CARGO_TYPES[0];
export const tierById = (id: string) => TIERS.find((t) => t.id === id) ?? TIERS[0];

/** Same rows as 0004 seeds; the server's `vehicle_classes` table is the source of truth. */
export const DEFAULT_CLASSES: VehicleClass[] = [
  { id: '11t', name: '11噸級', nickname: '六輪中型', sort: 1, active: true, baseFare: 1200, perKm: 30, perPallet: 120, maxPallets: 8, maxWeightT: 6, deckM: 6, grossT: '8.8–11噸' },
  { id: '17t', name: '17噸級', nickname: '十輪大貨車', sort: 2, active: true, baseFare: 1500, perKm: 38, perPallet: 150, maxPallets: 12, maxWeightT: 10, deckM: 7.5, grossT: '15–17噸' },
  { id: '26t', name: '26噸級', nickname: '三軸十二輪', sort: 3, active: true, baseFare: 2000, perKm: 48, perPallet: 150, maxPallets: 16, maxWeightT: 15, deckM: 9.6, grossT: '23–26噸' },
  { id: '35t', name: '35噸拖板', nickname: '半聯結車／平板', sort: 4, active: true, baseFare: 2600, perKm: 60, perPallet: 150, maxPallets: 22, maxWeightT: 24, deckM: 12.2, grossT: '35噸' },
];
/** "8 托" or "整車 · H型鋼 12 支" — pallets are 0 in full-truck mode */
export const loadLabel = (o: { pallets: number; loadMode?: LoadMode; quantityDesc?: string }) =>
  o.loadMode === 'full' ? `整車${o.quantityDesc ? ' · ' + o.quantityDesc : ''}` : `${o.pallets} 托`;
/** "17噸級" for tags; falls back to the id */
export const className = (classes: VehicleClass[], id: string) => classes.find((c) => c.id === id)?.name ?? id;

export const classById = (classes: VehicleClass[], id: string): VehicleClass =>
  classes.find((c) => c.id === id) ?? classes.find((c) => c.id === '17t') ?? classes[0] ?? DEFAULT_CLASSES[1];

/** 最小能載的級距：托數與（選填）重量都放得下；整車模式只看重量。找不到就回最大的。 */
export function recommendClass(classes: VehicleClass[], pallets: number, weightT: number | undefined, loadMode: LoadMode): VehicleClass {
  const list = classes.filter((c) => c.active).sort((a, b) => a.sort - b.sort);
  const fits = list.find((c) => (loadMode === 'full' || c.maxPallets >= pallets) && (weightT == null || c.maxWeightT >= weightT));
  return fits ?? list[list.length - 1] ?? DEFAULT_CLASSES[1];
}

export const TW_AREAS = ['基隆市', '臺北市', '新北市', '桃園市', '新竹市', '新竹縣', '苗栗縣', '臺中市', '彰化縣', '南投縣', '雲林縣', '嘉義市', '嘉義縣', '臺南市', '高雄市', '屏東縣', '宜蘭縣', '花蓮縣', '臺東縣'];

export const DOC_LABELS: Record<string, { title: string; hint: string }> = {
  id_front: { title: '身分證正面', hint: '' },
  id_back: { title: '身分證反面', hint: '' },
  license: { title: '職業駕照（正面）', hint: '職業大貨車或職業聯結車駕駛執照，四角要清楚' },
  license_back: { title: '職業駕照（反面）', hint: '反面有審驗紀錄，要看得到最近一次審驗' },
  vehicle_reg: { title: '行照', hint: '' },
  vehicle_front: { title: '車頭照片', hint: '要看得到車牌' },
  vehicle_bed: { title: '車斗照片', hint: '從後方拍，看得到尾門／護欄' },
  business_proof: { title: '營業證明', hint: '貨運行登記證或公司在職證明' },
  affiliation_proof: { title: '靠行證明', hint: '靠行合約或貨運業者開立之證明' },
  insurance_compulsory: { title: '強制險保單', hint: '' },
  insurance_liability: { title: '第三人責任險（選填）', hint: '有的話上傳，貨主看得到' },
  insurance_cargo: { title: '貨物運送險（選填）', hint: '' },
  bank_passbook: { title: '存摺封面', hint: '撥款帳戶，戶名要與本人或所屬業者一致' },
};

export const CARRIER_DECLARATION =
  '我確認本人／所屬業者具備執行本平台所刊載運送服務之合法資格，且本人已取得必要之授權，不違反與車輛所有人、靠行業者或其他相關業者間之契約；本人所提供之文件均為真實；我了解平台僅提供媒合、估價、付款工具與運送追蹤，運送契約由本人／所屬業者與託運人直接成立，平台不負運送責任。';
