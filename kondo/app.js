// ゴルフスコア管理アプリ（年度別ファイル対応版・近藤/鹿中グループ用）

// ===== 定数 =====
const USERS = ['近藤', '鹿中'];
// 本グループのデータはS3上で「kondo/」プレフィックス配下に分離保存される（既存グループと競合しない）
const DATA_GROUP = 'kondo';
// localStorageキーも既存グループと分離（同一ドメイン配信でも競合しない）
const STORAGE_KEY = 'golfScoreAppKondo';
const CONFIG_STORAGE_KEY = 'golfScoreAppKondoConfig';
const MIN_PARTICIPANTS = 2; // 有効ラウンドの最小参加人数（2名グループのため2）
const MIN_ROUNDS = 3; // ランキング対象の最小参加回数

// ===== データ同期設定 =====
// Lambda関数URLを設定してUSE_LAMBDA_SYNCをtrueにすると自動同期が有効になります
const LAMBDA_FUNCTION_URL = 'https://mefcgox3zuhgvvixc4rebnr2xa0tmzbm.lambda-url.ap-northeast-1.on.aws/';
const USE_LAMBDA_SYNC = true; // Lambda関数URL経由で自動保存
const USE_S3_SYNC = false; // S3同期を有効にするかどうか（手動アップロード方式）

// ===== 状態管理 =====
let appState = {
    currentUser: null,
    currentYear: new Date().getFullYear(),
    availableYears: [],     // 利用可能な年度リスト
    config: null,           // 共通設定（ハンディキャップなど）
    yearData: {},           // 年度別データのキャッシュ { 2025: {...}, 2026: {...} }
    editingRound: null,     // 編集中のラウンドのインデックス
    editingYear: null,      // 編集中のラウンドの年度
    editingOriginalDate: null,    // 編集中のラウンドの元の日付
    editingOriginalCourse: null,  // 編集中のラウンドの元のコース名
    lastSyncTime: null,     // 最終同期時刻
    showNetScore: true      // true: ネット（HC適用）, false: グロス
};

// ===== ユーティリティ関数 =====
// 名前に「さん」を付ける（ログインボタン以外で使用）
function withSan(name) {
    return name + 'さん';
}

// ===== 初期化 =====
document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

async function initApp() {
    // データ読み込み（非同期）
    await loadData();

    // 年度セレクタを動的に生成
    updateYearSelectors();

    // 現在の年度を設定
    const currentYear = new Date().getFullYear();
    if (appState.availableYears.includes(currentYear)) {
        appState.currentYear = currentYear;
    } else if (appState.availableYears.length > 0) {
        appState.currentYear = appState.availableYears[appState.availableYears.length - 1];
    }

    // ログイン画面の年度選択を現在年度に設定
    const yearSelect = document.getElementById('year-select');
    if (yearSelect) {
        yearSelect.value = appState.currentYear.toString();
    }

    // ユーザーボタン生成
    generateUserButtons();

    // ログイン画面の統計表示
    updateLoginStats();

    // イベントリスナー設定
    setupEventListeners();
}

// ===== データ読み込み =====
async function loadData() {
    // Lambda関数URL同期が有効な場合
    if (USE_LAMBDA_SYNC && LAMBDA_FUNCTION_URL) {
        try {
            // 1. 設定ファイルを取得
            const config = await fetchConfig();
            if (config) {
                appState.config = config;
                localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config));
            }

            // 2. 利用可能な年度一覧を取得
            const years = await fetchAvailableYears();
            appState.availableYears = years;

            // 現在の年度も追加（データがなくても選択可能にする）
            const currentYear = new Date().getFullYear();
            if (!appState.availableYears.includes(currentYear)) {
                appState.availableYears.push(currentYear);
                appState.availableYears.sort((a, b) => a - b);
            }

            // 3. 各年度のデータを取得
            for (const year of appState.availableYears) {
                const yearData = await fetchYearData(year);
                if (yearData) {
                    appState.yearData[year] = yearData;
                }
            }

            appState.lastSyncTime = new Date();
            console.log('Lambda関数からデータを読み込みました');
            return;
        } catch (error) {
            console.warn('Lambda関数からのデータ取得に失敗:', error);
        }
    }

    // ローカルストレージからデータを読み込み
    const savedConfig = localStorage.getItem(CONFIG_STORAGE_KEY);
    if (savedConfig) {
        appState.config = JSON.parse(savedConfig);
    } else {
        appState.config = getDefaultConfig();
    }

    // ローカルストレージから年度データを読み込み
    const savedData = localStorage.getItem(STORAGE_KEY);
    if (savedData) {
        const data = JSON.parse(savedData);
        // 旧形式のデータを新形式に変換
        if (data.years) {
            Object.keys(data.years).forEach(year => {
                appState.yearData[year] = {
                    year: parseInt(year),
                    rounds: data.years[year].rounds || [],
                    holeInOnes: data.years[year].holeInOnes || [],
                    eagles: data.years[year].eagles || [],
                    albatrosses: data.years[year].albatrosses || [],
                    cupName: data.cupNames?.[year] || '近藤杯'
                };
                if (!appState.availableYears.includes(parseInt(year))) {
                    appState.availableYears.push(parseInt(year));
                }
            });
            appState.availableYears.sort((a, b) => a - b);
            // ハンディキャップを設定に移行
            if (data.handicaps) {
                appState.config.handicaps = data.handicaps;
            }
        }
    } else if (typeof initialData !== 'undefined') {
        // 初期データを使用（旧形式からの変換）
        Object.keys(initialData.years).forEach(year => {
            appState.yearData[year] = {
                year: parseInt(year),
                rounds: initialData.years[year].rounds || [],
                holeInOnes: initialData.years[year].holeInOnes || [],
                eagles: initialData.years[year].eagles || [],
                albatrosses: initialData.years[year].albatrosses || [],
                cupName: initialData.cupNames?.[year] || '近藤杯'
            };
            if (!appState.availableYears.includes(parseInt(year))) {
                appState.availableYears.push(parseInt(year));
            }
        });
        appState.availableYears.sort((a, b) => a - b);
        if (initialData.handicaps) {
            appState.config.handicaps = initialData.handicaps;
        }
    }

    // 現在の年度を追加
    const currentYear = new Date().getFullYear();
    if (!appState.availableYears.includes(currentYear)) {
        appState.availableYears.push(currentYear);
        appState.availableYears.sort((a, b) => a - b);
    }
}

// デフォルト設定を取得
function getDefaultConfig() {
    return {
        availableYears: [],
        handicaps: {
            "近藤": 0,
            "鹿中": 0
        },
        courses: {
            "default": { "rating": 72.0, "slope": 113, "par": 72 }
        },
        courseNames: []
    };
}

// 空の年度データを取得
function getEmptyYearData(year) {
    return {
        year: parseInt(year),
        rounds: [],
        holeInOnes: [],
        eagles: [],
        albatrosses: [],
        cupName: '近藤杯'
    };
}

// ===== WHS ハンディキャップ計算 =====
// 差分スコアを計算
function calculateDifferential(score, courseName) {
    const courseData = appState.config.courses?.[courseName] || appState.config.courses?.["default"] || { rating: 72.0, slope: 113 };
    const differential = (score - courseData.rating) * (113 / courseData.slope);
    return differential;
}

// ユーザーのハンディキャップインデックスを計算
function calculateHandicapIndex(user) {
    // 全年度から全ラウンドを取得
    const allRounds = [];
    Object.values(appState.yearData).forEach(yearData => {
        if (yearData.rounds) {
            yearData.rounds.forEach(round => {
                if (round.scores[user] && round.scores[user].score) {
                    allRounds.push({
                        date: round.date,
                        course: round.course,
                        score: round.scores[user].score,
                        differential: calculateDifferential(round.scores[user].score, round.course)
                    });
                }
            });
        }
    });

    // 日付順にソート（新しい順）
    allRounds.sort((a, b) => new Date(b.date) - new Date(a.date));

    // 20回未満の場合は全ラウンド、20回以上の場合は直近20ラウンド
    const targetRounds = allRounds.length < 20 ? allRounds : allRounds.slice(0, 20);

    if (targetRounds.length < 3) {
        return { index: 0, best8: [], totalRounds: targetRounds.length };
    }

    // ベスト採用数を決定
    // 20回未満: 全ラウンドからベスト8（ただし全ラウンド数が8未満の場合は全て）
    // 20回以上: 直近20からベスト8
    const numBest = Math.min(8, targetRounds.length);

    // 差分スコアでソート
    const sortedByDifferential = [...targetRounds].sort((a, b) => a.differential - b.differential);
    const best = sortedByDifferential.slice(0, numBest);

    // ベスト平均を計算
    const avgDifferential = best.reduce((sum, r) => sum + r.differential, 0) / best.length;

    // ハンディキャップインデックス = 平均差分 × 0.96
    const handicapIndex = Math.round(avgDifferential * 0.96 * 10) / 10;

    return {
        index: Math.max(0, handicapIndex), // 負の値を防ぐ
        best8: best,
        totalRounds: targetRounds.length
    };
}

// ===== Lambda API関数 =====
// 設定ファイルを取得
async function fetchConfig() {
    try {
        const response = await fetch(`${LAMBDA_FUNCTION_URL}?action=config&group=${DATA_GROUP}&t=${Date.now()}`);
        if (!response.ok) throw new Error('設定取得エラー');
        return await response.json();
    } catch (error) {
        console.warn('設定取得エラー:', error);
        return null;
    }
}

// 利用可能な年度一覧を取得
async function fetchAvailableYears() {
    try {
        const response = await fetch(`${LAMBDA_FUNCTION_URL}?action=years&group=${DATA_GROUP}&t=${Date.now()}`);
        if (!response.ok) throw new Error('年度一覧取得エラー');
        const data = await response.json();
        return data.years || [];
    } catch (error) {
        console.warn('年度一覧取得エラー:', error);
        return [];
    }
}

// 特定年度のデータを取得
async function fetchYearData(year) {
    try {
        const response = await fetch(`${LAMBDA_FUNCTION_URL}?year=${year}&group=${DATA_GROUP}&t=${Date.now()}`);
        if (!response.ok) throw new Error('年度データ取得エラー');
        return await response.json();
    } catch (error) {
        console.warn(`${year}年データ取得エラー:`, error);
        return null;
    }
}

// 年度データを保存
async function saveYearDataToLambda(year, data) {
    try {
        console.log('Lambda送信データ:', data); // デバッグ用
        const response = await fetch(`${LAMBDA_FUNCTION_URL}?group=${DATA_GROUP}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!response.ok) {
            const errorText = await response.text();
            console.error('Lambda エラーレスポンス:', errorText);
            throw new Error(`年度データ保存エラー: ${response.status} ${errorText}`);
        }
        console.log(`${year}年データを保存しました`);
        return true;
    } catch (error) {
        console.error('年度データ保存エラー:', error);
        return false;
    }
}

// 設定を保存
async function saveConfigToLambda(config) {
    try {
        const response = await fetch(`${LAMBDA_FUNCTION_URL}?action=config&group=${DATA_GROUP}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config)
        });
        if (!response.ok) throw new Error('設定保存エラー');
        console.log('設定を保存しました');
        return true;
    } catch (error) {
        console.error('設定保存エラー:', error);
        return false;
    }
}

// ===== データ保存 =====
async function saveYearData(year, options = {}) {
    const yearData = appState.yearData[year];
    if (!yearData) return;

    // ローカルストレージに保存（互換性のため旧形式で）
    saveToLocalStorage();

    // Lambda同期が有効な場合
    if (USE_LAMBDA_SYNC && LAMBDA_FUNCTION_URL) {
        // データを準備
        let dataToSend = { ...yearData };

        // replaceMode: 削除操作時はマージせず上書き
        if (options.replaceMode) {
            dataToSend.replaceMode = true;
        }

        // deleteRound: コース名変更時に元のラウンドを削除
        if (options.deleteRound) {
            dataToSend.deleteRound = options.deleteRound;
        }

        const success = await saveYearDataToLambda(year, dataToSend);
        if (success) {
            showSaveSuccessNotification();
        } else {
            showSaveErrorNotification();
        }
        return;
    }

    // S3同期が有効な場合
    if (USE_S3_SYNC) {
        showSyncNotification();
    }
}

async function saveConfig() {
    // ローカルストレージに保存
    localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(appState.config));

    // Lambda同期が有効な場合
    if (USE_LAMBDA_SYNC && LAMBDA_FUNCTION_URL) {
        const success = await saveConfigToLambda(appState.config);
        if (success) {
            showSaveSuccessNotification();
        } else {
            showSaveErrorNotification();
        }
        return;
    }
}

// ローカルストレージに保存（旧形式互換）
function saveToLocalStorage() {
    const data = {
        years: {},
        handicaps: appState.config.handicaps,
        cupNames: {}
    };

    Object.entries(appState.yearData).forEach(([year, yearData]) => {
        data.years[year] = {
            rounds: yearData.rounds,
            holeInOnes: yearData.holeInOnes,
            eagles: yearData.eagles,
            albatrosses: yearData.albatrosses || []
        };
        data.cupNames[year] = yearData.cupName;
    });

    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

// 保存成功通知
function showSaveSuccessNotification() {
    alert('データをS3に保存しました。全ユーザーが確認できます。');
}

// 保存エラー通知
function showSaveErrorNotification() {
    alert('S3への保存に失敗しました。ネットワーク接続を確認してください。');
}

// S3へのアップロード通知
function showSyncNotification() {
    const existingNotification = document.getElementById('sync-notification');
    if (existingNotification) {
        existingNotification.remove();
    }

    const notification = document.createElement('div');
    notification.id = 'sync-notification';
    notification.className = 'sync-notification';
    notification.innerHTML = `
        <p>データが更新されました</p>
        <button onclick="downloadDataForS3()" class="btn-primary">S3用データをダウンロード</button>
        <button onclick="closeSyncNotification()" class="btn-secondary">閉じる</button>
    `;
    document.body.appendChild(notification);
}

function closeSyncNotification() {
    const notification = document.getElementById('sync-notification');
    if (notification) {
        notification.remove();
    }
}

// S3アップロード用のデータダウンロード（年度別）
function downloadDataForS3() {
    const year = appState.currentYear;
    const yearData = appState.yearData[year];
    if (!yearData) return;

    const dataStr = JSON.stringify(yearData, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `data-${year}.json`;
    a.click();

    URL.revokeObjectURL(url);
    closeSyncNotification();
    alert(`data-${year}.jsonをダウンロードしました。\nS3バケットにアップロードしてデータを共有してください。`);
}

// データを最新に更新（Lambdaから再取得）
async function refreshData() {
    if (USE_LAMBDA_SYNC && LAMBDA_FUNCTION_URL) {
        try {
            // 設定を再取得
            const config = await fetchConfig();
            if (config) {
                appState.config = config;
                localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config));
            }

            // 年度一覧を再取得
            const years = await fetchAvailableYears();
            if (years.length > 0) {
                appState.availableYears = years;
                const currentYear = new Date().getFullYear();
                if (!appState.availableYears.includes(currentYear)) {
                    appState.availableYears.push(currentYear);
                    appState.availableYears.sort((a, b) => a - b);
                }
            }

            // 現在選択中の年度のデータを再取得
            const yearData = await fetchYearData(appState.currentYear);
            if (yearData) {
                appState.yearData[appState.currentYear] = yearData;
            }

            appState.lastSyncTime = new Date();
            updateAllViews();
            alert('最新データを取得しました');
            return;
        } catch (error) {
            alert('エラー: ' + error.message);
        }
    }

    alert('同期が無効です');
}

// ===== 年度リスト生成 =====
function getAvailableYears() {
    return appState.availableYears.map(y => y.toString());
}

function updateYearSelectors() {
    const years = getAvailableYears();
    const currentYear = new Date().getFullYear().toString();

    const selectors = ['year-select', 'my-input-year', 'input-year'];

    selectors.forEach(id => {
        const select = document.getElementById(id);
        if (!select) return;

        const currentValue = select.value;

        select.innerHTML = years.map(year =>
            `<option value="${year}">${year}年</option>`
        ).join('');

        if (currentValue && years.includes(currentValue)) {
            select.value = currentValue;
        } else if (years.includes(currentYear)) {
            select.value = currentYear;
        }
    });

    // ログイン画面の年度選択の変更イベント
    const yearSelect = document.getElementById('year-select');
    if (yearSelect && !yearSelect.hasAttribute('data-listener-added')) {
        yearSelect.addEventListener('change', async (e) => {
            appState.currentYear = parseInt(e.target.value);
            // その年度のデータがなければ取得
            if (!appState.yearData[appState.currentYear]) {
                if (USE_LAMBDA_SYNC && LAMBDA_FUNCTION_URL) {
                    const yearData = await fetchYearData(appState.currentYear);
                    if (yearData) {
                        appState.yearData[appState.currentYear] = yearData;
                    } else {
                        appState.yearData[appState.currentYear] = getEmptyYearData(appState.currentYear);
                    }
                } else {
                    appState.yearData[appState.currentYear] = getEmptyYearData(appState.currentYear);
                }
            }
            updateLoginStats();
        });
        yearSelect.setAttribute('data-listener-added', 'true');
    }
}

// ===== ユーザーボタン生成 =====
function generateUserButtons() {
    const container = document.getElementById('user-buttons');
    container.innerHTML = '';

    USERS.forEach(user => {
        const btn = document.createElement('button');
        btn.className = 'user-btn';
        btn.textContent = user;
        btn.addEventListener('click', () => login(user));
        container.appendChild(btn);
    });
}

// ===== 現在の年度データを取得するヘルパー =====
function getCurrentYearData() {
    const year = appState.currentYear;
    if (!appState.yearData[year]) {
        appState.yearData[year] = getEmptyYearData(year);
    }
    return appState.yearData[year];
}

// ===== ログイン画面の統計表示 =====
function updateLoginStats() {
    const yearData = getCurrentYearData();
    if (!yearData || !yearData.rounds) return;

    const rounds = yearData.rounds;
    const validRounds = rounds.filter(r => countParticipants(r) >= MIN_PARTICIPANTS);

    // 総合ランキング（ハンディ適用）
    const rankings = USERS.map(user => {
        const userRounds = validRounds.filter(r => r.scores[user] && r.scores[user].score);
        const handicapIndex = calculateHandicapIndex(user).index;
        const scores = userRounds.map(r => {
            let score = r.scores[user].score;
            // 自動計算されたハンディキャップインデックスを適用
            score -= handicapIndex;
            return score;
        });

        return {
            user,
            rounds: userRounds.length,
            average: scores.length >= 1 ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
            isValid: scores.length >= 1
        };
    }).filter(r => r.isValid)
      .sort((a, b) => a.average - b.average);

    // 同率順位を計算
    let currentRank = 1;
    let prevAverage = null;
    rankings.forEach((r, i) => {
        if (prevAverage !== null && r.average.toFixed(1) !== prevAverage.toFixed(1)) {
            currentRank = i + 1;
        }
        r.rank = currentRank;
        prevAverage = r.average;
    });

    // ランキング表示
    const rankingList = document.getElementById('login-ranking-list');
    if (rankingList) {
        if (rankings.length > 0) {
            const top6 = rankings.slice(0, 6);
            rankingList.innerHTML = top6.map(r => {
                const badge = r.rank <= 3 ? `<span class="login-rank-badge rank-${r.rank}">${r.rank}</span>` : `<span class="login-rank-num">${r.rank}</span>`;
                return `<div class="login-rank-item">${badge}<span class="login-rank-name">${withSan(r.user)}</span><span class="login-rank-avg">${r.average.toFixed(1)}</span></div>`;
            }).join('');
        } else {
            rankingList.innerHTML = '<div class="no-data">データなし</div>';
        }
    }

    // ベストスコア（同率一位の場合は全員表示）
    const bestScore = getBestScore(rounds);
    document.getElementById('login-best-score').textContent = bestScore.score || '-';
    document.getElementById('login-best-score-holder').textContent = bestScore.users.length > 0 ? bestScore.users.map(u => withSan(u)).join(', ') : '-';

    // ベストパット平均（同率一位の場合は全員表示）
    const bestPutt = getBestPuttAverage(rounds);
    document.getElementById('login-best-putt').textContent = bestPutt.average ? bestPutt.average.toFixed(2) : '-';
    document.getElementById('login-best-putt-holder').textContent = bestPutt.users.length > 0 ? bestPutt.users.map(u => withSan(u)).join(', ') : '-';

    // パーオン率ベスト（同率一位の場合は全員表示）
    const bestParOn = getBestParOnRate(rounds);
    document.getElementById('login-best-paron').textContent = bestParOn.rate ? bestParOn.rate.toFixed(1) + '%' : '-';
    document.getElementById('login-best-paron-holder').textContent = bestParOn.users.length > 0 ? bestParOn.users.map(u => withSan(u)).join(', ') : '-';

    // 誤差ベスト（平均スコア変化）
    const bestImprovement = getBestScoreChange();
    if (bestImprovement.change !== null) {
        const sign = bestImprovement.change > 0 ? '+' : '';
        document.getElementById('login-best-improvement').textContent = sign + bestImprovement.change.toFixed(1);
    } else {
        document.getElementById('login-best-improvement').textContent = '-';
    }
    document.getElementById('login-best-improvement-holder').textContent = bestImprovement.user ? withSan(bestImprovement.user) : '-';
}

// ===== ログイン/ログアウト =====
async function login(user) {
    appState.currentUser = user;

    // 選択された年度のデータがなければ取得
    if (!appState.yearData[appState.currentYear]) {
        if (USE_LAMBDA_SYNC && LAMBDA_FUNCTION_URL) {
            const yearData = await fetchYearData(appState.currentYear);
            if (yearData) {
                appState.yearData[appState.currentYear] = yearData;
            } else {
                appState.yearData[appState.currentYear] = getEmptyYearData(appState.currentYear);
            }
        } else {
            appState.yearData[appState.currentYear] = getEmptyYearData(appState.currentYear);
        }
    }

    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('main-screen').classList.remove('hidden');
    document.getElementById('current-user').textContent = withSan(user);

    updateAllViews();
}

function logout() {
    appState.currentUser = null;
    appState.editingRound = null;
    appState.editingOriginalDate = null;
    appState.editingOriginalCourse = null;
    document.getElementById('main-screen').classList.add('hidden');
    document.getElementById('login-screen').classList.remove('hidden');
}

// ===== イベントリスナー =====
function setupEventListeners() {
    // 重複登録を防ぐためのチェック
    if (document.getElementById('logout-btn').hasAttribute('data-listener-added')) {
        return;
    }
    document.getElementById('logout-btn').setAttribute('data-listener-added', 'true');

    document.getElementById('logout-btn').addEventListener('click', logout);

    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            switchTab(e.target.dataset.tab);
        });
    });

    document.getElementById('filter-user').addEventListener('change', updateScoresTable);
    document.getElementById('filter-course').addEventListener('change', updateScoresTable);

    document.getElementById('save-score-btn').addEventListener('click', saveScore);
    document.getElementById('new-score-btn').addEventListener('click', resetInputForm);
    document.getElementById('delete-score-btn').addEventListener('click', deleteRound);
    document.getElementById('save-my-score-btn').addEventListener('click', saveMyScore);
    document.getElementById('save-cup-name-btn').addEventListener('click', saveCupName);
    document.getElementById('add-course-name-btn').addEventListener('click', addCourseName);
    document.getElementById('update-handicap-btn').addEventListener('click', updateAndSaveHandicaps);

    document.getElementById('export-btn').addEventListener('click', exportData);
    document.getElementById('import-btn').addEventListener('click', () => {
        document.getElementById('import-file').click();
    });
    document.getElementById('import-file').addEventListener('change', importData);
}

function switchTab(tabId) {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabId);
    });

    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.toggle('active', content.id === tabId);
    });

    if (tabId === 'ranking') {
        updateRankings();
    } else if (tabId === 'scores') {
        updateScoresTable();
    } else if (tabId === 'bulk-input') {
        setupInputForm();
    } else if (tabId === 'my-input') {
        setupMyInputForm();
    } else if (tabId === 'handicap') {
        updateHandicapView();
    }
}

// ===== 全画面更新 =====
function updateAllViews() {
    updateYearSelectors();
    updateCupName();
    updateDashboard();
    updateRankings();
    updateScoresTable();
    setupInputForm();
    setupMyInputForm();
    setupCupNameSettings();
    renderCourseNameList();
    updateFilters();
    updateCourseDatalist();
}

// ===== ダッシュボード =====
function updateDashboard() {
    const yearData = getCurrentYearData();
    if (!yearData || !yearData.rounds) return;

    const validRounds = yearData.rounds.filter(r => countParticipants(r) >= MIN_PARTICIPANTS);
    document.getElementById('total-rounds').textContent = validRounds.length;

    const participationCounts = getParticipationCounts(yearData.rounds);
    const validParticipants = Object.values(participationCounts).filter(c => c >= MIN_ROUNDS).length;
    document.getElementById('valid-participants').textContent = validParticipants;

    const bestScore = getBestScore(yearData.rounds);
    document.getElementById('best-score-value').textContent = bestScore.score || '-';
    document.getElementById('best-score-holder').textContent = bestScore.users.length > 0 ? bestScore.users.map(u => withSan(u)).join(', ') : '-';

    const bestPutt = getBestPuttAverage(yearData.rounds);
    document.getElementById('best-putt-value').textContent = bestPutt.average ? bestPutt.average.toFixed(2) : '-';
    document.getElementById('best-putt-holder').textContent = bestPutt.users.length > 0 ? bestPutt.users.map(u => withSan(u)).join(', ') : '-';

    const bestParOn = getBestParOnRate(yearData.rounds);
    document.getElementById('best-paron-value').textContent = bestParOn.rate ? bestParOn.rate.toFixed(1) + '%' : '-';
    document.getElementById('best-paron-holder').textContent = bestParOn.users.length > 0 ? bestParOn.users.map(u => withSan(u)).join(', ') : '-';

    updateMyStats(yearData.rounds);
    updateSpecialAchievements(yearData);
    updateDashboardRanking(yearData.rounds);
}

function updateMyStats(rounds) {
    const user = appState.currentUser;
    const validRounds = rounds.filter(r => {
        const score = r.scores[user];
        return score && score.score && countParticipants(r) >= MIN_PARTICIPANTS;
    });

    document.getElementById('my-rounds').textContent = validRounds.length;

    if (validRounds.length > 0) {
        const scores = validRounds.map(r => r.scores[user].score);
        const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
        const bestScore = Math.min(...scores);

        document.getElementById('my-avg-score').textContent = avgScore.toFixed(1);
        document.getElementById('my-best-score').textContent = bestScore;

        const putts = validRounds.filter(r => r.scores[user].putt).map(r => r.scores[user].putt);
        if (putts.length > 0) {
            const avgPutt = putts.reduce((a, b) => a + b, 0) / putts.length;
            document.getElementById('my-avg-putt').textContent = avgPutt.toFixed(2);
        } else {
            document.getElementById('my-avg-putt').textContent = '-';
        }
    } else {
        document.getElementById('my-avg-score').textContent = '-';
        document.getElementById('my-best-score').textContent = '-';
        document.getElementById('my-avg-putt').textContent = '-';
    }
}

function updateSpecialAchievements(yearData) {
    const hioList = document.getElementById('hole-in-one-list');
    if (yearData.holeInOnes && yearData.holeInOnes.length > 0) {
        hioList.innerHTML = yearData.holeInOnes.map(h =>
            `<li>${withSan(h.user)} - ${h.date} (${h.course} ${h.hole}番ホール)</li>`
        ).join('');
    } else {
        hioList.innerHTML = '<li class="no-data">達成者なし</li>';
    }

    const eagleList = document.getElementById('eagle-list');
    if (yearData.eagles && yearData.eagles.length > 0) {
        eagleList.innerHTML = yearData.eagles.map(e =>
            `<li>${withSan(e.user)} - ${e.date} (${e.course} ${e.hole}番ホール)</li>`
        ).join('');
    } else {
        eagleList.innerHTML = '<li class="no-data">達成者なし</li>';
    }

    const albatrossList = document.getElementById('albatross-list');
    if (albatrossList) {
        if (yearData.albatrosses && yearData.albatrosses.length > 0) {
            albatrossList.innerHTML = yearData.albatrosses.map(a =>
                `<li>${withSan(a.user)} - ${a.date} (${a.course} ${a.hole}番ホール)</li>`
            ).join('');
        } else {
            albatrossList.innerHTML = '<li class="no-data">達成者なし</li>';
        }
    }
}

function updateDashboardRanking(rounds) {
    const tbody = document.querySelector('#dashboard-overall-ranking tbody');
    if (!tbody) return;

    const validRounds = rounds.filter(r => countParticipants(r) >= MIN_PARTICIPANTS);

    const rankings = USERS.map(user => {
        const userRounds = validRounds.filter(r => r.scores[user] && r.scores[user].score);
        const handicapIndex = calculateHandicapIndex(user).index;
        const scores = userRounds.map(r => {
            let score = r.scores[user].score;
            // 自動計算されたハンディキャップインデックスを適用
            score -= handicapIndex;
            return score;
        });

        return {
            user,
            rounds: userRounds.length,
            average: scores.length >= 1 ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
            isValid: scores.length >= 1
        };
    }).filter(r => r.isValid)
      .sort((a, b) => a.average - b.average);

    let currentRank = 1;
    let prevAverage = null;
    rankings.forEach((r, i) => {
        if (prevAverage !== null && r.average.toFixed(1) !== prevAverage.toFixed(1)) {
            currentRank = i + 1;
        }
        r.rank = currentRank;
        prevAverage = r.average;
    });

    if (rankings.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="no-data">ランキング対象者なし</td></tr>';
        return;
    }

    tbody.innerHTML = rankings.map((r) => {
        const award = getAwardBadge(r.rank);
        return `
            <tr class="rank-${r.rank}">
                <td>${r.rank}</td>
                <td>${r.user}</td>
                <td>${r.average.toFixed(1)}</td>
                <td>${r.rounds}回</td>
                <td>${award}</td>
            </tr>
        `;
    }).join('');
}

// ===== ランキング =====
function updateRankings() {
    const yearData = getCurrentYearData();
    if (!yearData || !yearData.rounds) return;

    // ネット（HC適用）とグロス（HCなし）の両方を表示
    updateOverallRanking(yearData.rounds, true, 'overall-ranking-net');  // ネット
    updateOverallRanking(yearData.rounds, false, 'overall-ranking-gross'); // グロス
    updateBestScoreRanking(yearData.rounds, false);  // ベストスコアはグロスで表示
    updatePuttRanking(yearData.rounds);
    updateParOnRanking(yearData.rounds);
    updateScoreChangeRanking();
}

function updateOverallRanking(rounds, applyHandicap, tableId) {
    const tbody = document.querySelector(`#${tableId} tbody`);
    if (!tbody) return;

    const validRounds = rounds.filter(r => countParticipants(r) >= MIN_PARTICIPANTS);

    const rankings = USERS.map(user => {
        const userRounds = validRounds.filter(r => r.scores[user] && r.scores[user].score);
        const handicapIndex = applyHandicap ? calculateHandicapIndex(user).index : 0;
        const scores = userRounds.map(r => {
            let score = r.scores[user].score;
            // 自動計算されたハンディキャップインデックスを適用
            score -= handicapIndex;
            return score;
        });

        return {
            user,
            rounds: userRounds.length,
            average: scores.length >= 1 ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
            isValid: scores.length >= 1
        };
    }).filter(r => r.isValid)
      .sort((a, b) => a.average - b.average);

    let currentRank = 1;
    let prevAverage = null;
    rankings.forEach((r, i) => {
        if (prevAverage !== null && r.average.toFixed(1) !== prevAverage.toFixed(1)) {
            currentRank = i + 1;
        }
        r.rank = currentRank;
        prevAverage = r.average;
    });

    // ネット（HC適用）の場合のみ賞を表示
    if (applyHandicap) {
        tbody.innerHTML = rankings.map((r) => {
            const award = getAwardBadge(r.rank);
            return `
                <tr class="rank-${r.rank}">
                    <td>${r.rank}</td>
                    <td>${r.user}</td>
                    <td>${r.average.toFixed(1)}</td>
                    <td>${r.rounds}回</td>
                    <td>${award}</td>
                </tr>
            `;
        }).join('');
    } else {
        // グロス（HCなし）の場合は賞列なし
        tbody.innerHTML = rankings.map((r) => {
            return `
                <tr class="rank-${r.rank}">
                    <td>${r.rank}</td>
                    <td>${r.user}</td>
                    <td>${r.average.toFixed(1)}</td>
                    <td>${r.rounds}回</td>
                </tr>
            `;
        }).join('');
    }
}

function updateBestScoreRanking(rounds, applyHandicap) {
    const tbody = document.querySelector('#best-score-ranking tbody');
    const validRounds = rounds.filter(r => countParticipants(r) >= MIN_PARTICIPANTS);

    const allScores = [];
    validRounds.forEach(round => {
        USERS.forEach(user => {
            if (round.scores[user] && round.scores[user].score) {
                const handicapIndex = applyHandicap ? calculateHandicapIndex(user).index : 0;
                let score = round.scores[user].score;
                // 自動計算されたハンディキャップインデックスを適用
                score -= handicapIndex;
                allScores.push({
                    user,
                    score,
                    originalScore: round.scores[user].score,
                    date: round.date,
                    course: round.course
                });
            }
        });
    });

    allScores.sort((a, b) => a.score - b.score);

    let currentRank = 1;
    let prevScore = null;
    allScores.forEach((s, i) => {
        if (prevScore !== null && s.score !== prevScore) {
            currentRank = i + 1;
        }
        s.rank = currentRank;
        prevScore = s.score;
    });

    const top10 = allScores.slice(0, 10);
    tbody.innerHTML = top10.map((s) => `
        <tr class="${s.rank === 1 ? 'rank-1' : ''}">
            <td>${s.rank}</td>
            <td>${s.user}</td>
            <td>${s.score}${applyHandicap && s.originalScore !== s.score ? ` (${s.originalScore})` : ''}</td>
            <td>${formatDate(s.date)}</td>
            <td>${s.course}</td>
        </tr>
    `).join('');
}

function updatePuttRanking(rounds) {
    const tbody = document.querySelector('#putt-ranking tbody');
    const validRounds = rounds.filter(r => countParticipants(r) >= MIN_PARTICIPANTS);

    const rankings = USERS.map(user => {
        const userRounds = validRounds.filter(r => r.scores[user] && r.scores[user].putt);
        const putts = userRounds.map(r => r.scores[user].putt);

        return {
            user,
            rounds: userRounds.length,
            average: putts.length >= 1 ? putts.reduce((a, b) => a + b, 0) / putts.length : null,
            isValid: putts.length >= 1
        };
    }).filter(r => r.isValid)
      .sort((a, b) => a.average - b.average);

    let currentRank = 1;
    let prevAverage = null;
    rankings.forEach((r, i) => {
        if (prevAverage !== null && r.average.toFixed(2) !== prevAverage.toFixed(2)) {
            currentRank = i + 1;
        }
        r.rank = currentRank;
        prevAverage = r.average;
    });

    tbody.innerHTML = rankings.map((r) => `
        <tr class="${r.rank === 1 ? 'rank-1' : ''}">
            <td>${r.rank}</td>
            <td>${r.user}</td>
            <td>${r.average.toFixed(2)}</td>
            <td>${r.rounds}回</td>
        </tr>
    `).join('');
}

function updateParOnRanking(rounds) {
    const tbody = document.querySelector('#paron-ranking tbody');
    if (!tbody) return;

    const validRounds = rounds.filter(r => countParticipants(r) >= MIN_PARTICIPANTS);

    const rankings = USERS.map(user => {
        const userRounds = validRounds.filter(r => r.scores[user] && r.scores[user].parOn !== undefined);

        if (userRounds.length < 1) {
            return { user, isValid: false };
        }

        // パーオン率の平均を計算（統合率のみ）
        const parOnRates = userRounds.map(r => r.scores[user].parOn).filter(v => v !== undefined && !isNaN(v));
        const avgRate = parOnRates.length > 0 ? parOnRates.reduce((a, b) => a + b, 0) / parOnRates.length : null;

        return {
            user,
            rounds: userRounds.length,
            rate: avgRate,
            isValid: avgRate !== null
        };
    }).filter(r => r.isValid)
      .sort((a, b) => b.rate - a.rate); // 降順

    let currentRank = 1;
    let prevRate = null;
    rankings.forEach((r, i) => {
        if (prevRate !== null && r.rate.toFixed(1) !== prevRate.toFixed(1)) {
            currentRank = i + 1;
        }
        r.rank = currentRank;
        prevRate = r.rate;
    });

    if (rankings.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="no-data">データが不足しています</td></tr>';
        return;
    }

    tbody.innerHTML = rankings.map((r) => `
        <tr class="${r.rank === 1 ? 'rank-1' : ''}">
            <td>${r.rank}</td>
            <td>${r.user}</td>
            <td><strong>${r.rate.toFixed(1)}%</strong></td>
            <td>${r.rounds}回</td>
        </tr>
    `).join('');
}

function updateScoreChangeRanking() {
    const tbody = document.querySelector('#score-change-ranking tbody');
    if (!tbody) return;

    const currentYear = appState.currentYear;
    const lastYear = currentYear - 1;

    const currentYearData = appState.yearData[currentYear];
    const lastYearData = appState.yearData[lastYear];

    if (!currentYearData || !lastYearData) {
        tbody.innerHTML = '<tr><td colspan="5" class="no-data">昨年度のデータがありません</td></tr>';
        return;
    }

    const currentValidRounds = currentYearData.rounds.filter(r => countParticipants(r) >= MIN_PARTICIPANTS);
    const lastValidRounds = lastYearData.rounds.filter(r => countParticipants(r) >= MIN_PARTICIPANTS);

    const rankings = USERS.map(user => {
        const currentUserRounds = currentValidRounds.filter(r => r.scores[user] && r.scores[user].score);
        const lastUserRounds = lastValidRounds.filter(r => r.scores[user] && r.scores[user].score);

        const currentScores = currentUserRounds.map(r => r.scores[user].score);
        const lastScores = lastUserRounds.map(r => r.scores[user].score);

        const currentAvg = currentScores.length >= 1 ? currentScores.reduce((a, b) => a + b, 0) / currentScores.length : null;
        const lastAvg = lastScores.length >= 1 ? lastScores.reduce((a, b) => a + b, 0) / lastScores.length : null;

        const change = (currentAvg !== null && lastAvg !== null) ? currentAvg - lastAvg : null;

        return {
            user,
            lastAvg,
            currentAvg,
            change,
            isValid: change !== null
        };
    }).filter(r => r.isValid)
      .sort((a, b) => a.change - b.change); // 昇順（マイナスが大きい方が上達）

    let currentRank = 1;
    let prevChange = null;
    rankings.forEach((r, i) => {
        if (prevChange !== null && r.change.toFixed(1) !== prevChange.toFixed(1)) {
            currentRank = i + 1;
        }
        r.rank = currentRank;
        prevChange = r.change;
    });

    if (rankings.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="no-data">データが不足しています</td></tr>';
        return;
    }

    tbody.innerHTML = rankings.map((r) => {
        const changeClass = r.change < 0 ? 'score-improved' : r.change > 0 ? 'score-worse' : '';
        const changeSign = r.change > 0 ? '+' : '';
        return `
            <tr class="${r.rank === 1 ? 'rank-1' : ''}">
                <td>${r.rank}</td>
                <td>${r.user}</td>
                <td>${r.lastAvg.toFixed(1)}</td>
                <td>${r.currentAvg.toFixed(1)}</td>
                <td class="${changeClass}">${changeSign}${r.change.toFixed(1)}</td>
            </tr>
        `;
    }).join('');
}

function getAwardBadge(rank) {
    switch (rank) {
        case 1: return '<span class="award-badge award-gold">優勝</span>';
        case 2: return '<span class="award-badge award-silver">準優勝</span>';
        case 3: return '<span class="award-badge award-bronze">3位</span>';
        case 4: return '';
        case 5: return '<span class="award-badge award-penalty">5位</span>';
        case 6: return '<span class="award-badge award-penalty">6位</span>';
        default: return '';
    }
}

// ===== スコア一覧 =====
function updateFilters() {
    const yearData = getCurrentYearData();
    if (!yearData || !yearData.rounds) return;

    const userSelect = document.getElementById('filter-user');
    userSelect.innerHTML = '<option value="all">全員</option>' +
        USERS.map(u => `<option value="${u}">${u}</option>`).join('');

    const courses = [...new Set(yearData.rounds.map(r => r.course))];
    const courseSelect = document.getElementById('filter-course');
    courseSelect.innerHTML = '<option value="all">すべて</option>' +
        courses.map(c => `<option value="${c}">${c}</option>`).join('');

    const hioSelect = document.getElementById('hole-in-one-input');
    const eagleSelect = document.getElementById('eagle-input');
    const albatrossSelect = document.getElementById('albatross-input');
    const userOptions = '<option value="">なし</option>' +
        USERS.map(u => `<option value="${u}">${u}</option>`).join('');
    hioSelect.innerHTML = userOptions;
    eagleSelect.innerHTML = userOptions;
    if (albatrossSelect) {
        albatrossSelect.innerHTML = userOptions;
    }
}

function updateScoresTable() {
    const yearData = getCurrentYearData();
    const year = appState.currentYear;
    if (!yearData || !yearData.rounds) return;

    const filterUser = document.getElementById('filter-user').value;
    const filterCourse = document.getElementById('filter-course').value;

    let rounds = [...yearData.rounds];

    if (filterCourse !== 'all') {
        rounds = rounds.filter(r => r.course === filterCourse);
    }

    const tbody = document.querySelector('#scores-table tbody');
    tbody.innerHTML = rounds.map((round, i) => {
        const participants = countParticipants(round);
        const isValid = participants >= MIN_PARTICIPANTS;
        const roundIndex = yearData.rounds.indexOf(round);

        return `
            <tr style="${!isValid ? 'opacity: 0.5;' : ''}" data-round-index="${roundIndex}">
                <td>第${round.roundNumber || i + 1}回</td>
                <td>${formatDate(round.date)}</td>
                <td>${round.course}</td>
                <td>${participants}名${!isValid ? ' (無効)' : ''}</td>
                ${USERS.map(user => {
                    const scoreData = round.scores[user];
                    if (scoreData && scoreData.score) {
                        const showUser = filterUser === 'all' || filterUser === user;
                        if (!showUser) return '<td class="not-participated">-</td>';
                        return `
                            <td class="score-cell">
                                <div class="score-value">${scoreData.score}</div>
                                ${scoreData.putt ? `<div class="putt-value">(${scoreData.putt})</div>` : ''}
                            </td>
                        `;
                    }
                    return '<td class="not-participated">-</td>';
                }).join('')}
                <td>
                    <button class="btn-edit" onclick="editRound(${roundIndex}, '${year}')">編集</button>
                </td>
            </tr>
        `;
    }).join('');
}

// ===== スコア入力 =====
function setupInputForm() {
    const container = document.getElementById('score-inputs');
    const yearSelect = document.getElementById('input-year');

    if (appState.editingRound !== null) {
        const editYear = appState.editingYear || appState.currentYear;
        const yearData = appState.yearData[editYear];
        if (!yearData) return;

        const round = yearData.rounds[appState.editingRound];
        document.getElementById('bulk-input-title').textContent = `${editYear}年 第${round.roundNumber}回 スコア編集`;
        yearSelect.value = editYear;
        yearSelect.disabled = true;
        document.getElementById('input-date').value = round.date;
        document.getElementById('input-course').value = round.course;

        container.innerHTML = USERS.map(user => {
            const scoreData = round.scores[user] || {};
            const parOnRate = scoreData.parOn || '';
            return `
                <div class="score-input-item">
                    <label>${user}</label>
                    <input type="number" id="score-${user}" placeholder="スコア" min="50" max="200" inputmode="numeric" value="${scoreData.score || ''}">
                    <input type="number" id="putt-${user}" placeholder="パット" min="10" max="80" inputmode="numeric" value="${scoreData.putt || ''}">
                    <input type="number" id="paron-${user}" placeholder="パーオン率(%)" min="0" max="100" step="0.1" inputmode="decimal" value="${parOnRate}">
                </div>
            `;
        }).join('');

        document.getElementById('save-score-btn').textContent = '更新';
        document.getElementById('delete-score-btn').classList.remove('hidden');
    } else {
        document.getElementById('bulk-input-title').textContent = '全員のスコアを一括入力';
        yearSelect.disabled = false;
        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];
        document.getElementById('input-date').value = todayStr;
        yearSelect.value = today.getFullYear().toString();
        document.getElementById('input-course').value = '';

        container.innerHTML = USERS.map(user => `
            <div class="score-input-item">
                <label>${user}</label>
                <input type="number" id="score-${user}" placeholder="スコア" min="50" max="200" inputmode="numeric">
                <input type="number" id="putt-${user}" placeholder="パット" min="10" max="80" inputmode="numeric">
                <input type="number" id="paron-${user}" placeholder="パーオン率(%)" min="0" max="100" step="0.1" inputmode="decimal">
            </div>
        `).join('');

        document.getElementById('save-score-btn').textContent = '保存';
        document.getElementById('delete-score-btn').classList.add('hidden');
    }
}

// ===== 個人スコア入力 =====
function setupMyInputForm() {
    const user = appState.currentUser;
    if (!user) return;

    document.getElementById('my-input-user').textContent = user;

    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    document.getElementById('my-input-date').value = todayStr;
    document.getElementById('my-input-year').value = today.getFullYear().toString();

    updateMyRecentScores();
}

function updateMyRecentScores() {
    const user = appState.currentUser;
    const container = document.getElementById('my-recent-scores');

    const myScores = [];
    Object.entries(appState.yearData).forEach(([year, yearData]) => {
        if (yearData.rounds) {
            yearData.rounds.forEach(round => {
                if (round.scores[user] && round.scores[user].score) {
                    myScores.push({
                        year,
                        date: round.date,
                        course: round.course,
                        score: round.scores[user].score,
                        putt: round.scores[user].putt
                    });
                }
            });
        }
    });

    myScores.sort((a, b) => new Date(b.date) - new Date(a.date));

    const recent = myScores.slice(0, 5);

    if (recent.length > 0) {
        container.innerHTML = `
            <ul class="recent-scores-list">
                ${recent.map(s => `
                    <li>
                        <span class="recent-score-date">${formatDate(s.date)}</span>
                        <span class="recent-score-value">${s.score}${s.putt ? ` (${s.putt})` : ''}</span>
                        <span class="recent-score-course">${s.course}</span>
                    </li>
                `).join('')}
            </ul>
        `;
    } else {
        container.innerHTML = '<p class="no-data">まだスコアがありません</p>';
    }
}

async function saveMyScore() {
    const user = appState.currentUser;
    const date = document.getElementById('my-input-date').value;
    const course = document.getElementById('my-input-course').value;
    const score = parseInt(document.getElementById('my-input-score').value);
    const putt = parseInt(document.getElementById('my-input-putt').value);
    const parOnInput = document.getElementById('my-input-paron').value;
    const parOn = parOnInput === '' ? 0.0 : parseFloat(parOnInput);
    const selectedYear = parseInt(document.getElementById('my-input-year').value);

    if (!date || !course) {
        alert('日付とコースを入力してください');
        return;
    }

    if (!score) {
        alert('スコアを入力してください');
        return;
    }

    // 年度データがなければ作成
    if (!appState.yearData[selectedYear]) {
        appState.yearData[selectedYear] = getEmptyYearData(selectedYear);
        if (!appState.availableYears.includes(selectedYear)) {
            appState.availableYears.push(selectedYear);
            appState.availableYears.sort((a, b) => a - b);
        }
    }

    const yearData = appState.yearData[selectedYear];

    let existingRound = yearData.rounds.find(r => r.date === date && r.course === course);

    if (existingRound) {
        existingRound.scores[user] = { score };
        if (putt) existingRound.scores[user].putt = putt;
        if (!isNaN(parOn)) existingRound.scores[user].parOn = parOn;
    } else {
        const roundNumber = yearData.rounds.length + 1;
        const newRound = {
            roundNumber,
            date,
            course,
            scores: {
                [user]: { score }
            }
        };
        if (putt) newRound.scores[user].putt = putt;
        if (!isNaN(parOn)) newRound.scores[user].parOn = parOn;
        yearData.rounds.push(newRound);
    }

    await saveYearData(selectedYear);

    document.getElementById('my-input-course').value = '';
    document.getElementById('my-input-score').value = '';
    document.getElementById('my-input-putt').value = '';
    document.getElementById('my-input-paron').value = '';

    updateAllViews();
}

// ===== コースリスト更新 =====
function updateCourseDatalist() {
    const courses = new Set();
    Object.values(appState.yearData).forEach(yearData => {
        if (yearData.rounds) {
            yearData.rounds.forEach(round => {
                if (round.course) courses.add(round.course);
            });
        }
    });

    // 手動追加されたコース名をマージ
    if (appState.config && appState.config.courseNames) {
        appState.config.courseNames.forEach(name => courses.add(name));
    }

    const sortedCourses = [...courses].sort();

    // datalist更新（後方互換）
    const datalist = document.getElementById('course-list');
    if (datalist) {
        datalist.innerHTML = sortedCourses.map(c => `<option value="${c}">`).join('');
    }

    // コース選択ドロップダウンを更新
    const courseOptions = '<option value=""></option>' +
        sortedCourses.map(c => `<option value="${c}">${c}</option>`).join('');

    const bulkSelect = document.getElementById('input-course-select');
    if (bulkSelect) {
        bulkSelect.innerHTML = courseOptions;
    }

    const mySelect = document.getElementById('my-input-course-select');
    if (mySelect) {
        mySelect.innerHTML = courseOptions;
    }

    // コース選択ドロップダウンのイベントリスナーを設定
    setupCourseSelectListener('input-course-select', 'input-course');
    setupCourseSelectListener('my-input-course-select', 'my-input-course');
}

// コース選択ドロップダウンから選択時にテキスト入力にセットする
function setupCourseSelectListener(selectId, inputId) {
    const select = document.getElementById(selectId);
    const input = document.getElementById(inputId);
    if (!select || !input) return;

    // 重複登録防止
    if (select.hasAttribute('data-listener-added')) return;
    select.setAttribute('data-listener-added', 'true');

    select.addEventListener('change', () => {
        if (select.value) {
            input.value = select.value;
        }
        // 選択後にselectをリセット（次回も選択可能にする）
        select.value = '';
    });
}

function resetInputForm() {
    appState.editingRound = null;
    appState.editingYear = null;
    appState.editingOriginalDate = null;
    appState.editingOriginalCourse = null;
    setupInputForm();
}

function editRound(index, year) {
    appState.editingRound = index;
    appState.editingYear = parseInt(year) || appState.currentYear;

    // 編集前の日付とコース名を記録（コース名変更時の対応用）
    const yearData = appState.yearData[appState.editingYear];
    if (yearData && yearData.rounds[index]) {
        appState.editingOriginalDate = yearData.rounds[index].date;
        appState.editingOriginalCourse = yearData.rounds[index].course;
    }

    switchTab('bulk-input');
}

async function deleteRound() {
    if (appState.editingRound === null) return;

    if (!confirm('このラウンドを削除しますか？')) return;

    const year = appState.editingYear || appState.currentYear;
    const yearData = appState.yearData[year];
    if (!yearData) return;

    yearData.rounds.splice(appState.editingRound, 1);

    yearData.rounds.forEach((round, i) => {
        round.roundNumber = i + 1;
    });

    // 削除操作はreplaceModeで上書き保存（マージすると復活するため）
    await saveYearData(year, { replaceMode: true });
    appState.editingRound = null;
    appState.editingYear = null;
    appState.editingOriginalDate = null;
    appState.editingOriginalCourse = null;
    updateAllViews();
    switchTab('scores');
}

async function saveScore() {
    const date = document.getElementById('input-date').value;
    const course = document.getElementById('input-course').value;
    const selectedYear = parseInt(document.getElementById('input-year').value);

    if (!date || !course) {
        alert('日付とコースを入力してください');
        return;
    }

    const scores = {};
    let hasAnyScore = false;

    USERS.forEach(user => {
        const score = parseInt(document.getElementById(`score-${user}`).value);
        const putt = parseInt(document.getElementById(`putt-${user}`).value);
        const parOnInput = document.getElementById(`paron-${user}`)?.value || '';
        const parOn = parOnInput === '' ? 0.0 : parseFloat(parOnInput);

        if (score) {
            scores[user] = { score };
            if (putt) scores[user].putt = putt;
            if (!isNaN(parOn)) scores[user].parOn = parOn;

            hasAnyScore = true;
        }
    });

    if (!hasAnyScore) {
        alert('少なくとも1名のスコアを入力してください');
        return;
    }

    const participants = Object.keys(scores).length;
    if (participants < MIN_PARTICIPANTS) {
        const proceed = confirm(`参加者が${participants}名です。有効なラウンドは${MIN_PARTICIPANTS}名以上必要です。それでも保存しますか？`);
        if (!proceed) return;
    }

    const year = appState.editingRound !== null
        ? (appState.editingYear || appState.currentYear)
        : selectedYear;

    if (!appState.yearData[year]) {
        appState.yearData[year] = getEmptyYearData(year);
        if (!appState.availableYears.includes(year)) {
            appState.availableYears.push(year);
            appState.availableYears.sort((a, b) => a - b);
        }
    }

    const yearData = appState.yearData[year];

    if (appState.editingRound !== null) {
        const round = yearData.rounds[appState.editingRound];
        round.date = date;
        round.course = course;
        round.scores = scores;
    } else {
        const roundNumber = yearData.rounds.length + 1;

        const newRound = {
            roundNumber,
            date,
            course,
            scores
        };

        yearData.rounds.push(newRound);
    }

    // 特別達成は新規・編集どちらでも追加可能
    const hioUser = document.getElementById('hole-in-one-input').value;
    const hioHole = document.getElementById('hole-in-one-hole').value;
    if (hioUser && hioHole) {
        yearData.holeInOnes.push({
            user: hioUser,
            date,
            course,
            hole: parseInt(hioHole)
        });
    }

    const eagleUser = document.getElementById('eagle-input').value;
    const eagleHole = document.getElementById('eagle-hole').value;
    if (eagleUser && eagleHole) {
        yearData.eagles.push({
            user: eagleUser,
            date,
            course,
            hole: parseInt(eagleHole)
        });
    }

    const albatrossUser = document.getElementById('albatross-input')?.value;
    const albatrossHole = document.getElementById('albatross-hole')?.value;
    if (albatrossUser && albatrossHole) {
        yearData.albatrosses.push({
            user: albatrossUser,
            date,
            course,
            hole: parseInt(albatrossHole)
        });
    }

    // 編集モードで日付またはコース名が変更された場合、元のラウンドを削除対象として指定
    const options = {};
    if (appState.editingRound !== null) {
        const originalDate = appState.editingOriginalDate;
        const originalCourse = appState.editingOriginalCourse;
        if (originalDate && originalCourse && (originalDate !== date || originalCourse !== course)) {
            // 日付またはコース名が変更された場合、元のラウンドを削除
            options.deleteRound = { date: originalDate, course: originalCourse };
        }
    }
    await saveYearData(year, options);

    appState.editingRound = null;
    appState.editingYear = null;
    appState.editingOriginalDate = null;
    appState.editingOriginalCourse = null;
    document.getElementById('input-course').value = '';
    document.getElementById('input-year').disabled = false;
    USERS.forEach(user => {
        document.getElementById(`score-${user}`).value = '';
        document.getElementById(`putt-${user}`).value = '';
    });
    document.getElementById('hole-in-one-input').value = '';
    document.getElementById('hole-in-one-hole').value = '';
    document.getElementById('eagle-input').value = '';
    document.getElementById('eagle-hole').value = '';
    const albatrossInputEl = document.getElementById('albatross-input');
    const albatrossHoleEl = document.getElementById('albatross-hole');
    if (albatrossInputEl) albatrossInputEl.value = '';
    if (albatrossHoleEl) albatrossHoleEl.value = '';

    updateAllViews();
}

// ===== ハンディキャップ確認画面 =====
function updateHandicapView() {
    const container = document.getElementById('handicap-list');

    const handicaps = USERS.map(user => {
        const hcData = calculateHandicapIndex(user);
        return {
            user,
            index: hcData.index,
            rounds: hcData.totalRounds,
            best8: hcData.best8
        };
    }).sort((a, b) => a.index - b.index);

    container.innerHTML = handicaps.map(hc => `
        <div class="handicap-item" onclick="showHandicapDetail('${hc.user}')">
            <div class="handicap-user">${hc.user}</div>
            <div class="handicap-index">${hc.index.toFixed(1)}</div>
            <div class="handicap-rounds">${hc.rounds}ラウンド</div>
        </div>
    `).join('');
}

function showHandicapDetail(user) {
    const hcData = calculateHandicapIndex(user);
    const detailTitle = document.getElementById('handicap-detail-title');
    const detailContainer = document.getElementById('handicap-detail');

    detailTitle.textContent = `${user}さんのハンディキャップ詳細`;

    // デバッグ用ログ
    console.log(`${user}のハンディキャップデータ:`, {
        totalRounds: hcData.totalRounds,
        best8Length: hcData.best8.length,
        best8: hcData.best8
    });

    if (hcData.best8.length === 0) {
        detailContainer.innerHTML = '<p class="no-data">データが不足しています（3ラウンド以上必要）</p>';
        return;
    }

    const avgDiff = hcData.best8.reduce((sum, r) => sum + r.differential, 0) / hcData.best8.length;

    detailContainer.innerHTML = `
        <div class="handicap-summary">
            <div class="summary-item">
                <span class="summary-label">ハンディキャップインデックス</span>
                <span class="summary-value">${hcData.index.toFixed(1)}</span>
            </div>
            <div class="summary-item">
                <span class="summary-label">対象ラウンド数</span>
                <span class="summary-value">${hcData.totalRounds}ラウンド</span>
            </div>
            <div class="summary-item">
                <span class="summary-label">ベスト採用数</span>
                <span class="summary-value">${hcData.best8.length}ラウンド</span>
            </div>
            <div class="summary-item">
                <span class="summary-label">平均差分スコア</span>
                <span class="summary-value">${avgDiff.toFixed(1)}</span>
            </div>
        </div>

        <h4>ベストスコア一覧</h4>
        <table class="best-scores-table">
            <thead>
                <tr>
                    <th>日付</th>
                    <th>コース</th>
                    <th>スコア</th>
                    <th>差分</th>
                </tr>
            </thead>
            <tbody>
                ${hcData.best8.map(round => `
                    <tr>
                        <td>${formatDate(round.date)}</td>
                        <td>${round.course}</td>
                        <td>${round.score}</td>
                        <td>${round.differential.toFixed(1)}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

// ===== カップ名設定 =====
function getCupName() {
    const year = appState.currentYear;
    const yearData = appState.yearData[year];
    if (yearData && yearData.cupName) {
        return yearData.cupName;
    }
    return '近藤杯';
}

function updateCupName() {
    const year = appState.currentYear;
    const cupName = getCupName();

    document.getElementById('cup-title').textContent = `${year}${cupName}`;

    const loginTitle = document.querySelector('.login-container h1');
    if (loginTitle) {
        loginTitle.textContent = cupName;
    }

    document.title = `${cupName} ゴルフスコア管理`;
}

function setupCupNameSettings() {
    const cupName = getCupName();
    const input = document.getElementById('cup-name-input');
    if (input) {
        input.value = cupName;
    }
}

async function saveCupName() {
    const input = document.getElementById('cup-name-input');
    const cupName = input.value.trim();

    if (!cupName) {
        alert('カップ名を入力してください');
        return;
    }

    const year = appState.currentYear;
    const yearData = getCurrentYearData();

    // カップ名を更新
    yearData.cupName = cupName;

    // 年度プロパティが存在することを確認（Lambda送信用）
    if (!yearData.year) {
        yearData.year = parseInt(year);
    }

    // appStateに反映
    appState.yearData[year] = yearData;

    try {
        await saveYearData(year);
        updateCupName();
        alert('カップ名を保存しました');
    } catch (error) {
        console.error('カップ名保存エラー:', error);
        alert('カップ名の保存に失敗しました');
    }
}

// ===== コース名管理 =====
async function addCourseName() {
    const input = document.getElementById('course-name-input');
    const courseName = input.value.trim();

    if (!courseName) {
        alert('コース名を入力してください');
        return;
    }

    if (!appState.config.courseNames) {
        appState.config.courseNames = [];
    }

    if (appState.config.courseNames.includes(courseName)) {
        alert('このコース名は既に登録されています');
        return;
    }

    appState.config.courseNames = [...appState.config.courseNames, courseName].sort();

    try {
        await saveConfig();
        input.value = '';
        renderCourseNameList();
        updateCourseDatalist();
        alert('コース名を追加しました');
    } catch (error) {
        console.error('コース名追加エラー:', error);
        alert('コース名の追加に失敗しました');
    }
}

async function deleteCourseName(courseName) {
    if (!confirm(`コース「${courseName}」を削除しますか？\n\n※スコアデータに存在するコースはドロップダウンに引き続き表示されます。`)) {
        return;
    }

    appState.config.courseNames = appState.config.courseNames.filter(c => c !== courseName);

    try {
        await saveConfig();
        renderCourseNameList();
        updateCourseDatalist();
    } catch (error) {
        console.error('コース名削除エラー:', error);
        alert('コース名の削除に失敗しました');
    }
}

function renderCourseNameList() {
    const container = document.getElementById('course-name-list');
    if (!container) return;

    const courseNames = appState.config.courseNames || [];

    if (courseNames.length === 0) {
        container.innerHTML = '<p class="no-data">手動追加されたコースはありません</p>';
        return;
    }

    container.innerHTML = courseNames.map(name =>
        `<div class="course-name-item">
            <span class="course-name-text">${escapeHtml(name)}</span>
            <button class="btn-delete-course" data-course="${escapeHtml(name)}">削除</button>
        </div>`
    ).join('');

    container.querySelectorAll('.btn-delete-course').forEach(btn => {
        btn.addEventListener('click', () => {
            deleteCourseName(btn.dataset.course);
        });
    });
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ===== ハンディキャップ更新 =====
async function updateAndSaveHandicaps() {
    const confirmMsg = 'ハンディキャップを更新しますか？\n\n直近20ラウンドのベスト8から計算された値がconfig.jsonに保存されます。\n※この操作は1月と6月に実施してください。';

    if (!confirm(confirmMsg)) {
        return;
    }

    // 全ユーザーのハンディキャップを計算
    USERS.forEach(user => {
        const hcData = calculateHandicapIndex(user);
        appState.config.handicaps[user] = hcData.index;
    });

    // ハンディキャップ更新日時を記録
    const now = new Date();
    appState.config.handicapUpdatedAt = now.toISOString();

    try {
        await saveConfig();
        updateHandicapView();
        alert(`ハンディキャップを更新しました\n更新日時: ${now.toLocaleString('ja-JP')}`);
    } catch (error) {
        console.error('ハンディキャップ保存エラー:', error);
        alert('ハンディキャップの保存に失敗しました');
    }
}

// ===== データエクスポート/インポート =====
function exportData() {
    const year = appState.currentYear;
    const yearData = appState.yearData[year];
    if (!yearData) return;

    const dataStr = JSON.stringify(yearData, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `data-${year}.json`;
    a.click();

    URL.revokeObjectURL(url);
}

function importData(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
        try {
            const importedData = JSON.parse(event.target.result);

            // 新形式（年度別）のチェック
            if (importedData.year && importedData.rounds) {
                const proceed = confirm(`${importedData.year}年のデータをインポートしますか？`);
                if (proceed) {
                    appState.yearData[importedData.year] = importedData;
                    if (!appState.availableYears.includes(importedData.year)) {
                        appState.availableYears.push(importedData.year);
                        appState.availableYears.sort((a, b) => a - b);
                    }
                    await saveYearData(importedData.year);
                    updateAllViews();
                    alert('データをインポートしました');
                }
            }
            // 旧形式のチェック
            else if (importedData.years && importedData.handicaps) {
                const proceed = confirm('旧形式のデータを検出しました。インポートしますか？');
                if (proceed) {
                    Object.keys(importedData.years).forEach(year => {
                        appState.yearData[year] = {
                            year: parseInt(year),
                            rounds: importedData.years[year].rounds || [],
                            holeInOnes: importedData.years[year].holeInOnes || [],
                            eagles: importedData.years[year].eagles || [],
                            cupName: importedData.cupNames?.[year] || '近藤杯'
                        };
                        if (!appState.availableYears.includes(parseInt(year))) {
                            appState.availableYears.push(parseInt(year));
                        }
                    });
                    appState.availableYears.sort((a, b) => a - b);
                    appState.config.handicaps = importedData.handicaps;

                    // 各年度を保存
                    for (const year of Object.keys(appState.yearData)) {
                        await saveYearData(year);
                    }
                    await saveConfig();

                    updateAllViews();
                    alert('データをインポートしました');
                }
            } else {
                throw new Error('無効なデータ形式です');
            }
        } catch (error) {
            alert('データのインポートに失敗しました: ' + error.message);
        }
    };
    reader.readAsText(file);

    e.target.value = '';
}

// ===== ユーティリティ関数 =====
function countParticipants(round) {
    return Object.values(round.scores).filter(s => s && s.score).length;
}

function getParticipationCounts(rounds) {
    const counts = {};
    USERS.forEach(user => counts[user] = 0);

    const validRounds = rounds.filter(r => countParticipants(r) >= MIN_PARTICIPANTS);
    validRounds.forEach(round => {
        USERS.forEach(user => {
            if (round.scores[user] && round.scores[user].score) {
                counts[user]++;
            }
        });
    });

    return counts;
}

function getBestScore(rounds) {
    const validRounds = rounds.filter(r => countParticipants(r) >= MIN_PARTICIPANTS);
    let bestScore = null;
    let bestUsers = [];

    const participationCounts = getParticipationCounts(rounds);
    const validUsers = USERS.filter(u => participationCounts[u] >= 1);

    validRounds.forEach(round => {
        validUsers.forEach(user => {
            if (round.scores[user] && round.scores[user].score) {
                const score = round.scores[user].score;
                if (bestScore === null || score < bestScore) {
                    bestScore = score;
                    bestUsers = [user];
                } else if (score === bestScore && !bestUsers.includes(user)) {
                    bestUsers.push(user);
                }
            }
        });
    });

    return { score: bestScore, user: bestUsers[0] || null, users: bestUsers };
}

function getBestPuttAverage(rounds) {
    const validRounds = rounds.filter(r => countParticipants(r) >= MIN_PARTICIPANTS);

    const participationCounts = getParticipationCounts(rounds);
    const validUsers = USERS.filter(u => participationCounts[u] >= 1);

    let bestAvg = null;
    let bestUsers = [];

    validUsers.forEach(user => {
        const userRounds = validRounds.filter(r => r.scores[user] && r.scores[user].putt);
        if (userRounds.length >= 1) {
            const putts = userRounds.map(r => r.scores[user].putt);
            const avg = putts.reduce((a, b) => a + b, 0) / putts.length;

            if (bestAvg === null || avg < bestAvg) {
                // 表示精度(小数点2桁)で比較して更新
                bestAvg = avg;
                bestUsers = [user];
            } else if (bestAvg !== null && avg.toFixed(2) === bestAvg.toFixed(2)) {
                bestUsers.push(user);
            }
        }
    });

    return { average: bestAvg, user: bestUsers[0] || null, users: bestUsers };
}

// 総合パーオン率を計算（Par3:4H, Par4:10H, Par5:4Hの重み付け平均）
function calculateTotalParOnRate(parOn) {
    if (!parOn || typeof parOn !== 'object') return null;

    const par3 = parOn.par3;
    const par4 = parOn.par4;
    const par5 = parOn.par5;

    // 少なくとも1つは値が必要
    if (par3 === undefined && par4 === undefined && par5 === undefined) return null;

    // 標準的なコース構成: Par3=4H, Par4=10H, Par5=4H (合計18H)
    const par3Holes = 4;
    const par4Holes = 10;
    const par5Holes = 4;

    let totalWeightedRate = 0;
    let totalHoles = 0;

    if (par3 !== undefined && !isNaN(par3)) {
        totalWeightedRate += par3 * par3Holes;
        totalHoles += par3Holes;
    }
    if (par4 !== undefined && !isNaN(par4)) {
        totalWeightedRate += par4 * par4Holes;
        totalHoles += par4Holes;
    }
    if (par5 !== undefined && !isNaN(par5)) {
        totalWeightedRate += par5 * par5Holes;
        totalHoles += par5Holes;
    }

    if (totalHoles === 0) return null;
    return totalWeightedRate / totalHoles;
}

function getBestParOnRate(rounds) {
    const validRounds = rounds.filter(r => countParticipants(r) >= MIN_PARTICIPANTS);

    const participationCounts = getParticipationCounts(rounds);
    const validUsers = USERS.filter(u => participationCounts[u] >= 1);

    let bestRate = null;
    let bestUsers = [];

    validUsers.forEach(user => {
        const userRounds = validRounds.filter(r => r.scores[user] && r.scores[user].parOn !== undefined);
        if (userRounds.length >= 1) {
            // パーオン率の平均を計算（統合率のみ）
            const parOnRates = userRounds.map(r => r.scores[user].parOn).filter(r => r !== undefined && !isNaN(r));
            if (parOnRates.length >= 1) {
                const avgRate = parOnRates.reduce((a, b) => a + b, 0) / parOnRates.length;

                if (bestRate === null || avgRate > bestRate) {
                    // 表示精度(小数点1桁)で比較して更新
                    bestRate = avgRate;
                    bestUsers = [user];
                } else if (bestRate !== null && avgRate.toFixed(1) === bestRate.toFixed(1)) {
                    bestUsers.push(user);
                }
            }
        }
    });

    return { rate: bestRate, user: bestUsers[0] || null, users: bestUsers };
}

function getBestScoreChange() {
    const currentYear = appState.currentYear;
    const lastYear = currentYear - 1;

    const currentYearData = appState.yearData[currentYear];
    const lastYearData = appState.yearData[lastYear];

    if (!currentYearData || !lastYearData) {
        return { change: null, user: null };
    }

    const currentValidRounds = currentYearData.rounds.filter(r => countParticipants(r) >= MIN_PARTICIPANTS);
    const lastValidRounds = lastYearData.rounds.filter(r => countParticipants(r) >= MIN_PARTICIPANTS);

    let best = { change: null, user: null };

    USERS.forEach(user => {
        const currentUserRounds = currentValidRounds.filter(r => r.scores[user] && r.scores[user].score);
        const lastUserRounds = lastValidRounds.filter(r => r.scores[user] && r.scores[user].score);

        const currentScores = currentUserRounds.map(r => r.scores[user].score);
        const lastScores = lastUserRounds.map(r => r.scores[user].score);

        if (currentScores.length >= 1 && lastScores.length >= 1) {
            const currentAvg = currentScores.reduce((a, b) => a + b, 0) / currentScores.length;
            const lastAvg = lastScores.reduce((a, b) => a + b, 0) / lastScores.length;
            const change = currentAvg - lastAvg;

            // 最も上達した人（changeが小さい＝マイナスが大きい）
            if (best.change === null || change < best.change) {
                best.change = change;
                best.user = user;
            }
        }
    });

    return best;
}

function formatDate(dateStr) {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return `${date.getMonth() + 1}/${date.getDate()}`;
}
