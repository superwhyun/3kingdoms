import type { CityDef, FactionDef, GeneralDef, Scenario } from '../schema';

/*
 * 시나리오: 190년 반동탁 연합 전후.
 * 인물·지명은 역사 기록 기반이며, 능력치·수치는 이 프로젝트에서 독자적으로 산정한 값이다.
 */

type CityRow = [
  id: string, name: string, x: number, y: number,
  pop10k: number, agr: number, com: number, def: number, loyalty: number,
  gold: number, food: number, troops: number, training: number, owner: string | null,
];

const cityRows: CityRow[] = [
  // 하북·요동
  ['xiangping', '양평', 920, 80, 18, 260, 180, 320, 60, 400, 5000, 4000, 40, null],
  ['beiping', '북평', 790, 95, 24, 300, 220, 380, 65, 700, 9000, 15000, 60, 'gongsun'],
  ['ji', '계', 660, 90, 30, 340, 280, 360, 60, 600, 8000, 9000, 50, 'gongsun'],
  ['jinyang', '진양', 470, 165, 26, 300, 200, 420, 55, 400, 5000, 4000, 40, null],
  ['nanpi', '남피', 700, 170, 40, 420, 360, 400, 70, 1000, 14000, 18000, 55, 'yuanshao'],
  ['ye', '업', 590, 205, 52, 480, 420, 520, 65, 1200, 16000, 16000, 55, 'yuanshao'],
  ['pingyuan', '평원', 715, 245, 28, 320, 260, 280, 75, 400, 5000, 5000, 50, 'liubei'],
  ['beihai', '북해', 840, 245, 34, 360, 340, 300, 65, 500, 6000, 4000, 35, null],
  // 중원
  ['henei', '하내', 520, 255, 36, 380, 300, 340, 60, 500, 6000, 4000, 40, null],
  ['luoyang', '낙양', 430, 300, 60, 400, 600, 640, 40, 2500, 20000, 30000, 70, 'dongzhuo'],
  ['puyang', '복양', 650, 280, 32, 360, 300, 300, 55, 400, 5000, 3000, 35, null],
  ['chenliu', '진류', 590, 310, 38, 380, 380, 320, 70, 700, 8000, 7000, 55, 'caocao'],
  ['xuchang', '허창', 545, 365, 42, 440, 360, 360, 60, 500, 6000, 3000, 35, null],
  ['xiaopei', '소패', 720, 330, 22, 300, 240, 260, 60, 400, 6000, 5000, 45, 'taoqian'],
  ['xiapi', '하비', 810, 345, 40, 420, 400, 420, 65, 900, 12000, 10000, 50, 'taoqian'],
  ['runan', '여남', 610, 420, 44, 420, 300, 300, 55, 600, 9000, 8000, 45, 'yuanshu'],
  ['shouchun', '수춘', 710, 425, 46, 460, 380, 380, 55, 500, 7000, 4000, 35, null],
  // 관중·서량
  ['wuwei', '무위', 80, 200, 16, 220, 200, 340, 70, 500, 6000, 10000, 70, 'mateng'],
  ['anding', '안정', 205, 220, 20, 260, 180, 300, 60, 400, 6000, 8000, 65, 'mateng'],
  ['tianshui', '천수', 165, 300, 24, 300, 200, 340, 60, 400, 6000, 7000, 60, 'mateng'],
  ['changan', '장안', 300, 300, 56, 460, 560, 700, 45, 2000, 22000, 25000, 70, 'dongzhuo'],
  ['wan', '완', 465, 395, 50, 460, 420, 380, 50, 1500, 15000, 15000, 50, 'yuanshu'],
  ['shangyong', '상용', 355, 405, 14, 220, 160, 360, 55, 300, 4000, 3000, 35, null],
  ['hanzhong', '한중', 245, 385, 30, 380, 300, 480, 70, 600, 9000, 6000, 45, null],
  // 형주
  ['xinye', '신야', 500, 440, 16, 280, 200, 220, 60, 300, 4000, 2000, 30, null],
  ['xiangyang', '양양', 480, 485, 44, 480, 460, 560, 75, 1200, 15000, 14000, 50, 'liubiao'],
  ['jiangling', '강릉', 445, 555, 38, 500, 380, 440, 70, 800, 14000, 8000, 45, 'liubiao'],
  ['jiangxia', '강하', 585, 520, 30, 380, 320, 420, 65, 600, 9000, 8000, 50, 'liubiao'],
  ['wuling', '무릉', 395, 625, 20, 320, 200, 260, 55, 300, 5000, 3000, 30, null],
  ['changsha', '장사', 525, 625, 30, 400, 300, 320, 75, 700, 10000, 12000, 65, 'sunjian'],
  // 익주
  ['zitong', '재동', 175, 440, 18, 320, 200, 460, 60, 400, 6000, 6000, 45, 'liuyan'],
  ['chengdu', '성도', 145, 525, 62, 560, 480, 520, 70, 1500, 20000, 15000, 50, 'liuyan'],
  ['jiangzhou', '강주', 265, 545, 30, 400, 320, 380, 60, 600, 9000, 6000, 45, 'liuyan'],
  ['jianning', '건녕', 175, 645, 18, 260, 160, 260, 45, 300, 4000, 4000, 40, null],
  // 강동
  ['lujiang', '여강', 720, 490, 26, 360, 280, 300, 60, 400, 6000, 3000, 35, null],
  ['chaisang', '시상', 660, 565, 22, 340, 260, 320, 60, 400, 6000, 3000, 35, null],
  ['jianye', '건업', 830, 440, 40, 440, 440, 380, 60, 600, 8000, 4000, 35, null],
  ['wu', '오', 890, 505, 38, 460, 420, 340, 60, 600, 8000, 4000, 35, null],
  ['kuaiji', '회계', 860, 610, 28, 360, 280, 280, 55, 400, 6000, 3000, 30, null],
];

const roads: [string, string][] = [
  ['xiangping', 'beiping'], ['beiping', 'ji'], ['ji', 'nanpi'], ['ji', 'jinyang'],
  ['jinyang', 'ye'], ['jinyang', 'henei'], ['nanpi', 'ye'], ['nanpi', 'pingyuan'],
  ['ye', 'henei'], ['ye', 'pingyuan'], ['ye', 'puyang'], ['pingyuan', 'beihai'], ['pingyuan', 'puyang'],
  ['beihai', 'xiapi'], ['henei', 'luoyang'], ['luoyang', 'changan'], ['luoyang', 'chenliu'],
  ['luoyang', 'xuchang'], ['luoyang', 'wan'], ['puyang', 'chenliu'], ['puyang', 'xiaopei'],
  ['chenliu', 'xuchang'], ['chenliu', 'xiaopei'], ['xuchang', 'runan'], ['xuchang', 'wan'],
  ['xiaopei', 'xiapi'], ['xiaopei', 'shouchun'], ['xiapi', 'jianye'], ['xiapi', 'shouchun'],
  ['runan', 'shouchun'], ['runan', 'xinye'], ['runan', 'jiangxia'], ['shouchun', 'lujiang'], ['shouchun', 'jianye'],
  ['wuwei', 'anding'], ['anding', 'tianshui'], ['anding', 'changan'], ['tianshui', 'changan'],
  ['tianshui', 'hanzhong'], ['changan', 'hanzhong'], ['changan', 'shangyong'],
  ['wan', 'xinye'], ['wan', 'shangyong'], ['shangyong', 'hanzhong'], ['shangyong', 'xiangyang'],
  ['hanzhong', 'zitong'], ['xinye', 'xiangyang'], ['xiangyang', 'jiangling'], ['xiangyang', 'jiangxia'],
  ['jiangling', 'jiangxia'], ['jiangling', 'wuling'], ['jiangling', 'jiangzhou'], ['jiangling', 'changsha'],
  ['jiangxia', 'chaisang'], ['jiangxia', 'lujiang'], ['wuling', 'changsha'], ['changsha', 'chaisang'],
  ['zitong', 'chengdu'], ['zitong', 'jiangzhou'], ['chengdu', 'jiangzhou'], ['chengdu', 'jianning'],
  ['jiangzhou', 'jianning'], ['jiangzhou', 'wuling'],
  ['lujiang', 'chaisang'], ['lujiang', 'jianye'], ['chaisang', 'kuaiji'], ['jianye', 'wu'], ['wu', 'kuaiji'],
];

/** 강을 끼는 도로: 장강·한수·황하 구간 */
const rivers: [string, string][] = [
  ['jiangling', 'jiangxia'], ['jiangxia', 'chaisang'], ['jiangxia', 'lujiang'], ['lujiang', 'chaisang'],
  ['lujiang', 'jianye'], ['jiangling', 'jiangzhou'], ['xiangyang', 'jiangxia'], ['xiangyang', 'jiangling'],
  ['henei', 'luoyang'], ['ye', 'puyang'], ['pingyuan', 'puyang'], ['shouchun', 'jianye'],
];

/** 병종 적성 보정 */
const aptBonus: Record<string, GeneralDef['apt']> = {
  sun_jian: { navy: 10 }, sun_ce: { navy: 10 }, cheng_pu: { navy: 15 }, huang_gai: { navy: 20 },
  han_dang: { navy: 15 }, zhou_yu: { navy: 25 }, lu_su: { navy: 10 }, gan_ning: { navy: 25 },
  zhou_tai: { navy: 20 }, jiang_qin: { navy: 20 }, chen_wu: { navy: 15 }, ling_cao: { navy: 15 },
  lu_meng: { navy: 20 }, lu_xun: { navy: 15 }, cai_mao: { navy: 25 }, zhang_yun: { navy: 20 },
  huang_zu: { navy: 15 }, wen_pin: { navy: 10 },
  ma_teng: { cavalry: 10 }, ma_chao: { cavalry: 10 }, pang_de: { cavalry: 10 }, ma_dai: { cavalry: 10 },
  gongsun_zan: { cavalry: 15 }, zhao_yun: { cavalry: 5 }, lu_bu: { cavalry: 5 }, zhang_liao: { cavalry: 10 },
  huang_zhong: { archer: 15 }, taishi_ci: { archer: 10 }, xiahou_yuan: { cavalry: 10, archer: 5 },
  zhuge_liang: { siege: 15 }, chen_deng: { siege: 10 }, li_dian: { siege: 5 }, man_chong: { siege: 10 },
};

const factions: FactionDef[] = [
  { id: 'dongzhuo', name: '동탁', ruler: 'dong_zhuo', color: '#6b4c9a' },
  { id: 'caocao', name: '조조', ruler: 'cao_cao', color: '#3b6fb6' },
  { id: 'yuanshao', name: '원소', ruler: 'yuan_shao', color: '#c9a227' },
  { id: 'yuanshu', name: '원술', ruler: 'yuan_shu', color: '#b07a3b' },
  { id: 'sunjian', name: '손견', ruler: 'sun_jian', color: '#c0392b' },
  { id: 'liubei', name: '유비', ruler: 'liu_bei', color: '#2e8b57' },
  { id: 'gongsun', name: '공손찬', ruler: 'gongsun_zan', color: '#8a9ba8' },
  { id: 'liubiao', name: '유표', ruler: 'liu_biao', color: '#2a9d8f' },
  { id: 'liuyan', name: '유언', ruler: 'liu_yan', color: '#d17aa6' },
  { id: 'mateng', name: '마등', ruler: 'ma_teng', color: '#8d5524' },
  { id: 'taoqian', name: '도겸', ruler: 'tao_qian', color: '#5d6d7e' },
];

type GenRow = [
  id: string, name: string, war: number, int: number, pol: number, cha: number,
  faction: string | null, city: string, hidden?: 'h',
];

const genRows: GenRow[] = [
  // 동탁
  ['dong_zhuo', '동탁', 82, 45, 22, 30, 'dongzhuo', 'luoyang'],
  ['lu_bu', '여포', 100, 28, 12, 38, 'dongzhuo', 'luoyang'],
  ['li_ru', '이유', 22, 88, 70, 40, 'dongzhuo', 'luoyang'],
  ['hua_xiong', '화웅', 88, 30, 20, 40, 'dongzhuo', 'luoyang'],
  ['zhang_liao', '장료', 91, 76, 52, 78, 'dongzhuo', 'luoyang'],
  ['gao_shun', '고순', 85, 52, 38, 60, 'dongzhuo', 'luoyang'],
  ['xu_rong', '서영', 72, 56, 40, 45, 'dongzhuo', 'luoyang'],
  ['li_jue', '이각', 74, 30, 18, 25, 'dongzhuo', 'changan'],
  ['guo_si', '곽사', 72, 28, 16, 24, 'dongzhuo', 'changan'],
  ['jia_xu', '가후', 45, 96, 82, 56, 'dongzhuo', 'changan'],
  ['zhang_ji', '장제', 70, 50, 44, 52, 'dongzhuo', 'changan'],
  ['niu_fu', '우보', 60, 24, 20, 26, 'dongzhuo', 'changan'],
  // 조조
  ['cao_cao', '조조', 74, 92, 92, 95, 'caocao', 'chenliu'],
  ['xiahou_dun', '하후돈', 89, 60, 66, 82, 'caocao', 'chenliu'],
  ['xiahou_yuan', '하후연', 88, 54, 44, 72, 'caocao', 'chenliu'],
  ['cao_ren', '조인', 85, 66, 58, 74, 'caocao', 'chenliu'],
  ['cao_hong', '조홍', 78, 40, 36, 52, 'caocao', 'chenliu'],
  ['yue_jin', '악진', 82, 50, 40, 56, 'caocao', 'chenliu'],
  ['li_dian', '이전', 76, 72, 66, 70, 'caocao', 'chenliu'],
  ['xun_yu', '순욱', 18, 94, 97, 86, 'caocao', 'chenliu'],
  // 원소
  ['yuan_shao', '원소', 68, 70, 68, 90, 'yuanshao', 'ye'],
  ['yan_liang', '안량', 92, 38, 30, 50, 'yuanshao', 'ye'],
  ['wen_chou', '문추', 91, 30, 26, 48, 'yuanshao', 'ye'],
  ['tian_feng', '전풍', 30, 92, 84, 52, 'yuanshao', 'ye'],
  ['ju_shou', '저수', 40, 91, 82, 62, 'yuanshao', 'ye'],
  ['shen_pei', '심배', 46, 76, 74, 54, 'yuanshao', 'nanpi'],
  ['feng_ji', '봉기', 34, 74, 70, 44, 'yuanshao', 'nanpi'],
  ['xu_you', '허유', 24, 80, 62, 34, 'yuanshao', 'nanpi'],
  ['zhang_he', '장합', 89, 70, 56, 66, 'yuanshao', 'nanpi'],
  ['gao_lan', '고람', 80, 48, 38, 50, 'yuanshao', 'nanpi'],
  // 원술
  ['yuan_shu', '원술', 64, 60, 52, 66, 'yuanshu', 'wan'],
  ['ji_ling', '기령', 82, 40, 36, 50, 'yuanshu', 'wan'],
  ['zhang_xun', '장훈', 66, 54, 50, 44, 'yuanshu', 'wan'],
  ['yan_xiang', '염상', 22, 74, 70, 50, 'yuanshu', 'wan'],
  ['lei_bo', '뇌박', 68, 36, 30, 32, 'yuanshu', 'runan'],
  ['chen_lan', '진란', 66, 34, 28, 30, 'yuanshu', 'runan'],
  ['qiao_rui', '교유', 70, 38, 34, 40, 'yuanshu', 'runan'],
  // 손견
  ['sun_jian', '손견', 92, 74, 70, 90, 'sunjian', 'changsha'],
  ['sun_ce', '손책', 93, 70, 68, 94, 'sunjian', 'changsha'],
  ['cheng_pu', '정보', 80, 72, 68, 76, 'sunjian', 'changsha'],
  ['huang_gai', '황개', 82, 66, 54, 72, 'sunjian', 'changsha'],
  ['han_dang', '한당', 80, 52, 46, 60, 'sunjian', 'changsha'],
  ['zu_mao', '조무', 72, 46, 40, 58, 'sunjian', 'changsha'],
  ['zhu_zhi', '주치', 64, 64, 66, 66, 'sunjian', 'changsha'],
  // 유비
  ['liu_bei', '유비', 76, 72, 74, 99, 'liubei', 'pingyuan'],
  ['guan_yu', '관우', 98, 76, 62, 92, 'liubei', 'pingyuan'],
  ['zhang_fei', '장비', 98, 32, 24, 46, 'liubei', 'pingyuan'],
  ['jian_yong', '간옹', 30, 66, 74, 72, 'liubei', 'pingyuan'],
  // 공손찬
  ['gongsun_zan', '공손찬', 84, 52, 50, 74, 'gongsun', 'beiping'],
  ['yan_gang', '엄강', 72, 40, 36, 46, 'gongsun', 'beiping'],
  ['tian_kai', '전해', 70, 46, 44, 50, 'gongsun', 'beiping'],
  ['gongsun_yue', '공손월', 68, 40, 38, 52, 'gongsun', 'ji'],
  ['guan_jing', '관정', 24, 58, 66, 36, 'gongsun', 'ji'],
  ['gongsun_xu', '공손속', 66, 44, 40, 48, 'gongsun', 'ji'],
  // 유표
  ['liu_biao', '유표', 44, 74, 82, 84, 'liubiao', 'xiangyang'],
  ['kuai_liang', '괴량', 26, 86, 84, 64, 'liubiao', 'xiangyang'],
  ['kuai_yue', '괴월', 32, 88, 80, 60, 'liubiao', 'xiangyang'],
  ['cai_mao', '채모', 70, 66, 64, 42, 'liubiao', 'xiangyang'],
  ['zhang_yun', '장윤', 60, 52, 48, 40, 'liubiao', 'jiangling'],
  ['wen_pin', '문빙', 82, 64, 56, 74, 'liubiao', 'jiangling'],
  ['huang_zu', '황조', 70, 46, 42, 48, 'liubiao', 'jiangxia'],
  ['liu_pan', '유반', 72, 40, 34, 46, 'liubiao', 'jiangxia'],
  // 유언
  ['liu_yan', '유언', 40, 70, 78, 70, 'liuyan', 'chengdu'],
  ['liu_zhang', '유장', 30, 50, 60, 66, 'liuyan', 'chengdu'],
  ['zhang_ren', '장임', 86, 76, 54, 72, 'liuyan', 'chengdu'],
  ['huang_quan', '황권', 50, 84, 82, 72, 'liuyan', 'chengdu'],
  ['zhang_song', '장송', 14, 86, 80, 22, 'liuyan', 'chengdu'],
  ['yan_yan', '엄안', 84, 66, 60, 70, 'liuyan', 'jiangzhou'],
  ['wu_yi', '오의', 74, 60, 58, 64, 'liuyan', 'jiangzhou'],
  ['leng_bao', '냉포', 76, 52, 36, 40, 'liuyan', 'zitong'],
  ['fa_zheng', '법정', 46, 94, 80, 52, 'liuyan', 'zitong'],
  // 마등
  ['ma_teng', '마등', 85, 48, 46, 82, 'mateng', 'wuwei'],
  ['ma_chao', '마초', 97, 40, 28, 80, 'mateng', 'wuwei'],
  ['han_sui', '한수', 74, 74, 70, 66, 'mateng', 'anding'],
  ['pang_de', '방덕', 92, 62, 48, 68, 'mateng', 'tianshui'],
  ['ma_dai', '마대', 82, 48, 42, 60, 'mateng', 'tianshui'],
  ['cheng_yi', '성의', 72, 30, 24, 40, 'mateng', 'anding'],
  // 도겸
  ['tao_qian', '도겸', 36, 56, 66, 70, 'taoqian', 'xiapi'],
  ['mi_zhu', '미축', 26, 72, 84, 86, 'taoqian', 'xiapi'],
  ['chen_deng', '진등', 54, 88, 82, 70, 'taoqian', 'xiapi'],
  ['cao_bao', '조표', 64, 30, 30, 30, 'taoqian', 'xiaopei'],
  ['zang_ba', '장패', 80, 54, 42, 60, 'taoqian', 'xiaopei'],
  // 재야 (발견됨)
  ['zhao_yun', '조운', 96, 76, 64, 86, null, 'beiping'],
  ['taishi_ci', '태사자', 93, 64, 48, 70, null, 'beihai'],
  ['kong_rong', '공융', 30, 70, 80, 82, null, 'beihai'],
  ['huang_zhong', '황충', 94, 62, 50, 70, null, 'changsha'],
  ['wei_yan', '위연', 90, 64, 42, 46, null, 'xiangyang'],
  ['gan_ning', '감녕', 92, 62, 30, 60, null, 'jiangxia'],
  ['zhou_yu', '주유', 74, 96, 86, 92, null, 'lujiang'],
  ['lu_su', '노숙', 54, 90, 88, 84, null, 'lujiang'],
  ['zhang_zhao', '장소', 18, 82, 94, 74, null, 'jianye'],
  ['chen_gong', '진궁', 50, 88, 74, 62, null, 'puyang'],
  ['xu_chu', '허저', 96, 30, 22, 54, null, 'runan'],
  ['dian_wei', '전위', 97, 32, 20, 52, null, 'chenliu'],
  ['xu_huang', '서황', 89, 70, 46, 68, null, 'henei'],
  ['zhang_lu', '장로', 40, 70, 80, 76, null, 'hanzhong'],
  ['shi_xie', '사섭', 30, 66, 84, 80, null, 'jianning'],
  ['gongsun_du', '공손도', 66, 62, 64, 58, null, 'xiangping'],
  ['zhang_yang', '장양', 54, 46, 52, 56, null, 'jinyang'],
  ['meng_da', '맹달', 68, 70, 60, 40, null, 'shangyong'],
  ['jiang_qin', '장흠', 80, 54, 46, 60, null, 'kuaiji'],
  ['zhou_tai', '주태', 88, 42, 30, 56, null, 'wu'],
  ['chen_wu', '진무', 80, 42, 34, 58, null, 'chaisang'],
  ['ling_cao', '능조', 76, 40, 30, 52, null, 'wu'],
  ['yu_jin', '우금', 82, 64, 56, 58, null, 'puyang'],
  ['man_chong', '만총', 50, 82, 86, 66, null, 'shouchun'],
  // 재야 (탐색 필요)
  ['zhuge_liang', '제갈량', 36, 100, 96, 94, null, 'xinye', 'h'],
  ['pang_tong', '방통', 32, 97, 84, 64, null, 'jiangling', 'h'],
  ['xu_shu', '서서', 64, 92, 80, 76, null, 'xinye', 'h'],
  ['guo_jia', '곽가', 16, 97, 76, 70, null, 'xuchang', 'h'],
  ['cheng_yu', '정욱', 44, 90, 78, 52, null, 'puyang', 'h'],
  ['xun_you', '순유', 28, 94, 82, 64, null, 'xuchang', 'h'],
  ['sima_yi', '사마의', 60, 99, 92, 82, null, 'henei', 'h'],
  ['lu_xun', '육손', 66, 95, 88, 84, null, 'wu', 'h'],
  ['lu_meng', '여몽', 82, 88, 74, 78, null, 'shouchun', 'h'],
  ['ma_liang', '마량', 26, 82, 84, 80, null, 'xiangyang', 'h'],
  ['jiang_wei', '강유', 90, 88, 66, 78, null, 'tianshui', 'h'],
  ['deng_zhi', '등지', 40, 78, 80, 72, null, 'jiangzhou', 'h'],
  ['zhang_hong', '장굉', 16, 80, 90, 70, null, 'jianye', 'h'],
  ['tian_yu', '전예', 72, 78, 74, 70, null, 'ji', 'h'],
];

function toCity(r: CityRow): CityDef {
  const [id, name, x, y, pop10k, agr, com, def, loyalty, gold, food, troops, training, owner] = r;
  return {
    id, name, x, y,
    population: pop10k * 10000,
    agriculture: agr, commerce: com, defense: def, loyalty,
    gold, food, troops, training, owner,
  };
}

function toGeneral(r: GenRow): GeneralDef {
  const [id, name, war, int, pol, cha, faction, city, hidden] = r;
  return {
    ...(aptBonus[id] ? { apt: aptBonus[id] } : {}),
    id, name, war, int, pol, cha, faction, city,
    status: faction ? 'active' : hidden ? 'hidden' : 'free',
    loyalty: faction ? 80 : 0,
  };
}

const rulerIds = new Set(factions.map((f) => f.ruler));

export const scenario190: Scenario = {
  id: 'y190',
  name: '190년 — 군웅할거',
  description: '낙양을 장악한 동탁에 맞서 각지의 군웅이 일어선다.',
  startYear: 190,
  startMonth: 1,
  cities: cityRows.map(toCity),
  roads,
  rivers,
  factions,
  generals: genRows
    .map(toGeneral)
    .map((g) => (rulerIds.has(g.id) ? { ...g, loyalty: 100 } : g)),
};
