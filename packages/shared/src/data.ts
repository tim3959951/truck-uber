import type { CargoType, Customer, Driver, HistoryItem, Location, Tier } from './types';

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
  { id: 'dedicated', name: '17噸 專車', desc: '立即派車，整車專屬', factor: 1.0, eta: '8 分鐘內到達' },
  { id: 'backhaul', name: '17噸 回頭車', desc: '順路回程車，價格較低、等候較久', factor: 0.75, eta: '約 25–40 分鐘' },
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
  { id: 'TK-2411', orderNo: 'TK-2411', date: '9/8', from: '觀音工業區', to: '員林 建材行', pallets: 12, cargo: '建材 / 磚水泥', total: 6980, driverAmount: 5933, status: 'completed' },
  { id: 'TK-2398', orderNo: 'TK-2398', date: '9/5', from: '觀音工業區', to: '新市 科學園區', pallets: 6, cargo: '機械設備', total: 9740, driverAmount: 8279, status: 'completed' },
];

export const locationById = (id: string) => LOCATIONS.find((l) => l.id === id) ?? LOCATIONS[0];
export const cargoById = (id: string) => CARGO_TYPES.find((c) => c.id === id) ?? CARGO_TYPES[0];
export const tierById = (id: string) => TIERS.find((t) => t.id === id) ?? TIERS[0];
