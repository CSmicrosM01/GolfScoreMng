// ゴルフスコア管理アプリ（年度別ファイル対応版）

// ===== 定数 =====
const USERS = ['松本', '正本', '渡邉', '近藤', '比企', '内藤'];
const STORAGE_KEY = 'golfScoreApp';
const CONFIG_STORAGE_KEY = 'golfScoreAppConfig';
const MIN_PARTICIPANTS = 3; // 有効ラウンドの最小参加人数
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
    lastSyncTime: null      // 最終同期時刻
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
                    cupName: data.cupNames?.[year] || '松本杯'
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
                cupName: initialData.cupNames?.[year] || '松本杯'
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
            "松本": 0,
            "正本": 0,
            "渡邉": 0,
            "近藤": 0,
            "比企": 0,
            "内藤": 0
        }
    };
}

// 空の年度データを取得
function getEmptyYearData(year) {
    return {
        year: parseInt(year),
        rounds: [],
        holeInOnes: [],
        eagles: [],
        cupName: '松本杯'
    };
}

// ===== Lambda API関数 =====
// 設定ファイルを取得
async function fetchConfig() {
    try {
        const response = await fetch(`${LAMBDA_FUNCTION_URL}?action=config&t=${Date.now()}`);
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
        const response = await fetch(`${LAMBDA_FUNCTION_URL}?action=years&t=${Date.now()}`);
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
        const response = await fetch(`${LAMBDA_FUNCTION_URL}?year=${year}&t=${Date.now()}`);
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
        const response = await fetch(LAMBDA_FUNCTION_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!response.ok) throw new Error('年度データ保存エラー');
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
        const response = await fetch(`${LAMBDA_FUNCTION_URL}?action=config`, {
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
async function saveYearData(year) {
    const yearData = appState.yearData[year];
    if (!yearData) return;

    // ローカルストレージに保存（互換性のため旧形式で）
    saveToLocalStorage();

    // Lambda同期が有効な場合
    if (USE_LAMBDA_SYNC && LAMBDA_FUNCTION_URL) {
        const success = await saveYearDataToLambda(year, yearData);
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
            eagles: yearData.eagles
        };
        data.cupNames[year] = yearData.cupName;
    });

    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

// 保存成功通知
function showSaveSuccessNotification() {
    const existingNotification = document.getElementById('sync-notification');
    if (existingNotification) {
        existingNotification.remove();
    }

    const notification = document.createElement('div');
    notification.id = 'sync-notification';
    notification.className = 'sync-notification success';
    notification.innerHTML = `
        <p>データを保存しました</p>
        <button onclick="closeSyncNotification()" class="btn-primary">OK</button>
    `;
    document.body.appendChild(notification);

    setTimeout(() => {
        closeSyncNotification();
    }, 3000);
}

// 保存エラー通知
function showSaveErrorNotification() {
    const existingNotification = document.getElementById('sync-notification');
    if (existingNotification) {
        existingNotification.remove();
    }

    const notification = document.createElement('div');
    notification.id = 'sync-notification';
    notification.className = 'sync-notification error';
    notification.innerHTML = `
        <p>保存に失敗しました</p>
        <button onclick="downloadDataForS3()" class="btn-primary">手動でダウンロード</button>
        <button onclick="closeSyncNotification()" class="btn-secondary">閉じる</button>
    `;
    document.body.appendChild(notification);
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
        const scores = userRounds.map(r => {
            let score = r.scores[user].score;
            score -= (appState.config.handicaps[user] || 0);
            return score;
        });

        return {
            user,
            rounds: userRounds.length,
            average: scores.length >= MIN_ROUNDS ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
            isValid: scores.length >= MIN_ROUNDS
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

    // ベストスコア
    const bestScore = getBestScore(rounds);
    document.getElementById('login-best-score').textContent = bestScore.score || '-';
    document.getElementById('login-best-score-holder').textContent = bestScore.user ? withSan(bestScore.user) : '-';

    // ベストパット平均
    const bestPutt = getBestPuttAverage(rounds);
    document.getElementById('login-best-putt').textContent = bestPutt.average ? bestPutt.average.toFixed(2) : '-';
    document.getElementById('login-best-putt-holder').textContent = bestPutt.user ? withSan(bestPutt.user) : '-';
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
    document.getElementById('main-screen').classList.add('hidden');
    document.getElementById('login-screen').classList.remove('hidden');
}

// ===== イベントリスナー =====
function setupEventListeners() {
    document.getElementById('logout-btn').addEventListener('click', logout);

    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            switchTab(e.target.dataset.tab);
        });
    });

    document.querySelectorAll('input[name="handicap-mode"]').forEach(radio => {
        radio.addEventListener('change', () => {
            updateRankings();
        });
    });

    document.getElementById('filter-user').addEventListener('change', updateScoresTable);
    document.getElementById('filter-course').addEventListener('change', updateScoresTable);

    document.getElementById('save-score-btn').addEventListener('click', saveScore);
    document.getElementById('new-score-btn').addEventListener('click', resetInputForm);
    document.getElementById('save-my-score-btn').addEventListener('click', saveMyScore);
    document.getElementById('save-handicap-btn').addEventListener('click', saveHandicaps);
    document.getElementById('save-cup-name-btn').addEventListener('click', saveCupName);

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
    } else if (tabId === 'awards') {
        setupHandicapSettings();
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
    setupHandicapSettings();
    setupCupNameSettings();
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
    document.getElementById('best-score-holder').textContent = bestScore.user ? withSan(bestScore.user) : '-';

    const bestPutt = getBestPuttAverage(yearData.rounds);
    document.getElementById('best-putt-value').textContent = bestPutt.average ? bestPutt.average.toFixed(2) : '-';
    document.getElementById('best-putt-holder').textContent = bestPutt.user ? withSan(bestPutt.user) : '-';

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
}

function updateDashboardRanking(rounds) {
    const tbody = document.querySelector('#dashboard-overall-ranking tbody');
    if (!tbody) return;

    const validRounds = rounds.filter(r => countParticipants(r) >= MIN_PARTICIPANTS);

    const rankings = USERS.map(user => {
        const userRounds = validRounds.filter(r => r.scores[user] && r.scores[user].score);
        const scores = userRounds.map(r => {
            let score = r.scores[user].score;
            score -= (appState.config.handicaps[user] || 0);
            return score;
        });

        return {
            user,
            rounds: userRounds.length,
            average: scores.length >= MIN_ROUNDS ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
            isValid: scores.length >= MIN_ROUNDS
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

    const applyHandicap = document.querySelector('input[name="handicap-mode"]:checked').value === 'with';

    updateOverallRanking(yearData.rounds, applyHandicap);
    updateBestScoreRanking(yearData.rounds, applyHandicap);
    updatePuttRanking(yearData.rounds);
}

function updateOverallRanking(rounds, applyHandicap) {
    const tbody = document.querySelector('#overall-ranking tbody');
    const validRounds = rounds.filter(r => countParticipants(r) >= MIN_PARTICIPANTS);

    const rankings = USERS.map(user => {
        const userRounds = validRounds.filter(r => r.scores[user] && r.scores[user].score);
        const scores = userRounds.map(r => {
            let score = r.scores[user].score;
            if (applyHandicap) {
                score -= (appState.config.handicaps[user] || 0);
            }
            return score;
        });

        return {
            user,
            rounds: userRounds.length,
            average: scores.length >= MIN_ROUNDS ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
            isValid: scores.length >= MIN_ROUNDS
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

function updateBestScoreRanking(rounds, applyHandicap) {
    const tbody = document.querySelector('#best-score-ranking tbody');
    const validRounds = rounds.filter(r => countParticipants(r) >= MIN_PARTICIPANTS);

    const allScores = [];
    validRounds.forEach(round => {
        USERS.forEach(user => {
            if (round.scores[user] && round.scores[user].score) {
                let score = round.scores[user].score;
                if (applyHandicap) {
                    score -= (appState.config.handicaps[user] || 0);
                }
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
            average: putts.length >= MIN_ROUNDS ? putts.reduce((a, b) => a + b, 0) / putts.length : null,
            isValid: putts.length >= MIN_ROUNDS
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
    const userOptions = '<option value="">なし</option>' +
        USERS.map(u => `<option value="${u}">${u}</option>`).join('');
    hioSelect.innerHTML = userOptions;
    eagleSelect.innerHTML = userOptions;
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
            return `
                <div class="score-input-item">
                    <label>${user}</label>
                    <input type="number" id="score-${user}" placeholder="スコア" min="50" max="200" inputmode="numeric" value="${scoreData.score || ''}">
                    <input type="number" id="putt-${user}" placeholder="パット数" min="10" max="80" inputmode="numeric" value="${scoreData.putt || ''}">
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
                <input type="number" id="putt-${user}" placeholder="パット数" min="10" max="80" inputmode="numeric">
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
        alert('スコアを更新しました');
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
        yearData.rounds.push(newRound);
        alert(`${selectedYear}年のスコアを保存しました`);
    }

    await saveYearData(selectedYear);

    document.getElementById('my-input-course').value = '';
    document.getElementById('my-input-score').value = '';
    document.getElementById('my-input-putt').value = '';

    updateAllViews();
}

// ===== コースリスト更新 =====
function updateCourseDatalist() {
    const datalist = document.getElementById('course-list');
    if (!datalist) return;

    const courses = new Set();
    Object.values(appState.yearData).forEach(yearData => {
        if (yearData.rounds) {
            yearData.rounds.forEach(round => {
                if (round.course) courses.add(round.course);
            });
        }
    });

    datalist.innerHTML = [...courses].sort().map(c => `<option value="${c}">`).join('');
}

function resetInputForm() {
    appState.editingRound = null;
    appState.editingYear = null;
    setupInputForm();
}

function editRound(index, year) {
    appState.editingRound = index;
    appState.editingYear = parseInt(year) || appState.currentYear;
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

    await saveYearData(year);
    appState.editingRound = null;
    appState.editingYear = null;
    alert('ラウンドを削除しました');
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

        if (score) {
            scores[user] = { score };
            if (putt) scores[user].putt = putt;
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
        alert('スコアを更新しました');
    } else {
        const roundNumber = yearData.rounds.length + 1;

        const newRound = {
            roundNumber,
            date,
            course,
            scores
        };

        yearData.rounds.push(newRound);

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

        alert(`${year}年のスコアを保存しました`);
    }

    await saveYearData(year);

    appState.editingRound = null;
    appState.editingYear = null;
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

    updateAllViews();
}

// ===== ハンディキャップ =====
function setupHandicapSettings() {
    const container = document.getElementById('handicap-settings');
    container.innerHTML = USERS.map(user => `
        <div class="handicap-item">
            <label>${user}</label>
            <input type="number" id="handicap-${user}" value="${appState.config.handicaps[user] || 0}" min="0" max="50">
        </div>
    `).join('');
}

async function saveHandicaps() {
    USERS.forEach(user => {
        const value = parseInt(document.getElementById(`handicap-${user}`).value) || 0;
        appState.config.handicaps[user] = value;
    });

    await saveConfig();
    alert('ハンディキャップを保存しました');
    updateRankings();
}

// ===== カップ名設定 =====
function getCupName() {
    const year = appState.currentYear;
    const yearData = appState.yearData[year];
    if (yearData && yearData.cupName) {
        return yearData.cupName;
    }
    return '松本杯';
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
    yearData.cupName = cupName;

    await saveYearData(year);
    updateCupName();
    alert('カップ名を保存しました');
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
                            cupName: importedData.cupNames?.[year] || '松本杯'
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
    let best = { score: null, user: null };

    const participationCounts = getParticipationCounts(rounds);
    const validUsers = USERS.filter(u => participationCounts[u] >= MIN_ROUNDS);

    validRounds.forEach(round => {
        validUsers.forEach(user => {
            if (round.scores[user] && round.scores[user].score) {
                if (best.score === null || round.scores[user].score < best.score) {
                    best.score = round.scores[user].score;
                    best.user = user;
                }
            }
        });
    });

    return best;
}

function getBestPuttAverage(rounds) {
    const validRounds = rounds.filter(r => countParticipants(r) >= MIN_PARTICIPANTS);

    const participationCounts = getParticipationCounts(rounds);
    const validUsers = USERS.filter(u => participationCounts[u] >= MIN_ROUNDS);

    let best = { average: null, user: null };

    validUsers.forEach(user => {
        const userRounds = validRounds.filter(r => r.scores[user] && r.scores[user].putt);
        if (userRounds.length >= MIN_ROUNDS) {
            const putts = userRounds.map(r => r.scores[user].putt);
            const avg = putts.reduce((a, b) => a + b, 0) / putts.length;

            if (best.average === null || avg < best.average) {
                best.average = avg;
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
