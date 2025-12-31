// ゴルフスコア管理アプリ

// ===== 定数 =====
const USERS = ['松本', '正本', '渡邉', '近藤', '比企', '内藤'];
const STORAGE_KEY = 'golfScoreApp';
const MIN_PARTICIPANTS = 3; // 有効ラウンドの最小参加人数
const MIN_ROUNDS = 3; // ランキング対象の最小参加回数

// ===== データ同期設定 =====
// Lambda関数URLを設定してUSE_LAMBDA_SYNCをtrueにすると自動同期が有効になります
const LAMBDA_FUNCTION_URL = 'https://mefcgox3zuhgvvixc4rebnr2xa0tmzbm.lambda-url.ap-northeast-1.on.aws/'; // 例: 'https://xxxxxxxxxx.lambda-url.ap-northeast-1.on.aws/'
const USE_LAMBDA_SYNC = true; // Lambda関数URL経由で自動保存
const S3_DATA_URL = './data.json'; // S3のデータファイルURL（読み込み用・フォールバック）
const USE_S3_SYNC = false; // S3同期を有効にするかどうか（手動アップロード方式）

// ===== 状態管理 =====
let appState = {
    currentUser: null,
    currentYear: 2025,
    data: null,
    editingRound: null, // 編集中のラウンドのインデックス
    editingYear: null,  // 編集中のラウンドの年度
    lastSyncTime: null  // 最終同期時刻
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

    // ユーザーボタン生成
    generateUserButtons();

    // イベントリスナー設定
    setupEventListeners();
}

async function loadData() {
    // Lambda関数URL同期が有効な場合、Lambdaからデータを取得
    if (USE_LAMBDA_SYNC && LAMBDA_FUNCTION_URL) {
        try {
            const lambdaData = await fetchLambdaData();
            if (lambdaData) {
                appState.data = lambdaData;
                appState.lastSyncTime = new Date();
                localStorage.setItem(STORAGE_KEY, JSON.stringify(appState.data));
                console.log('Lambda関数からデータを読み込みました');
                return;
            }
        } catch (error) {
            console.warn('Lambda関数からのデータ取得に失敗:', error);
        }
    }

    // S3同期が有効な場合、S3からデータを取得
    if (USE_S3_SYNC) {
        try {
            const s3Data = await fetchS3Data();
            if (s3Data) {
                appState.data = s3Data;
                appState.lastSyncTime = new Date();
                localStorage.setItem(STORAGE_KEY, JSON.stringify(appState.data));
                console.log('S3からデータを読み込みました');
                return;
            }
        } catch (error) {
            console.warn('S3からのデータ取得に失敗、ローカルデータを使用:', error);
        }
    }

    // localStorageからデータを読み込み、なければ初期データを使用
    const savedData = localStorage.getItem(STORAGE_KEY);
    if (savedData) {
        appState.data = JSON.parse(savedData);
    } else {
        appState.data = initialData;
    }
}

// Lambda関数URL経由でデータ取得
async function fetchLambdaData() {
    try {
        const response = await fetch(`${LAMBDA_FUNCTION_URL}?t=${Date.now()}`);
        if (!response.ok) {
            throw new Error('Lambda取得エラー');
        }
        return await response.json();
    } catch (error) {
        console.warn('Lambdaデータ取得エラー:', error);
        return null;
    }
}

// Lambda関数URL経由でデータ保存
async function saveLambdaData() {
    try {
        const response = await fetch(LAMBDA_FUNCTION_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(appState.data)
        });
        if (!response.ok) {
            throw new Error('Lambda保存エラー');
        }
        console.log('Lambda関数にデータを保存しました');
        return true;
    } catch (error) {
        console.error('Lambdaデータ保存エラー:', error);
        return false;
    }
}

async function fetchS3Data() {
    try {
        const response = await fetch(S3_DATA_URL + '?t=' + Date.now()); // キャッシュ回避
        if (!response.ok) {
            throw new Error('データファイルが見つかりません');
        }
        return await response.json();
    } catch (error) {
        console.warn('S3データ取得エラー:', error);
        return null;
    }
}

async function saveData() {
    // localStorageに保存
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appState.data));

    // Lambda関数URL同期が有効な場合、Lambdaに自動保存
    if (USE_LAMBDA_SYNC && LAMBDA_FUNCTION_URL) {
        const success = await saveLambdaData();
        if (success) {
            showSaveSuccessNotification();
        } else {
            showSaveErrorNotification();
        }
        return;
    }

    // S3同期が有効な場合、ダウンロード用のJSONを生成して通知
    if (USE_S3_SYNC) {
        showSyncNotification();
    }
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

    // 3秒後に自動で閉じる
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
    // 既存の通知があれば削除
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

// S3アップロード用のデータダウンロード
function downloadDataForS3() {
    const dataStr = JSON.stringify(appState.data, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = 'data.json'; // S3にアップロードするファイル名
    a.click();

    URL.revokeObjectURL(url);
    closeSyncNotification();
    alert('data.jsonをダウンロードしました。\nS3バケットにアップロードしてデータを共有してください。');
}

// データを最新に更新（LambdaまたはS3から再取得）
async function refreshData() {
    // Lambda関数URL同期が有効な場合
    if (USE_LAMBDA_SYNC && LAMBDA_FUNCTION_URL) {
        try {
            const lambdaData = await fetchLambdaData();
            if (lambdaData) {
                appState.data = lambdaData;
                appState.lastSyncTime = new Date();
                localStorage.setItem(STORAGE_KEY, JSON.stringify(appState.data));
                updateAllViews();
                alert('最新データを取得しました');
                return;
            }
        } catch (error) {
            console.warn('Lambda取得失敗、S3を試行:', error);
        }
    }

    // S3同期が有効な場合
    if (USE_S3_SYNC) {
        try {
            const s3Data = await fetchS3Data();
            if (s3Data) {
                appState.data = s3Data;
                appState.lastSyncTime = new Date();
                localStorage.setItem(STORAGE_KEY, JSON.stringify(appState.data));
                updateAllViews();
                alert('最新データを取得しました');
                return;
            }
        } catch (error) {
            alert('エラー: ' + error.message);
            return;
        }
    }

    alert('同期が無効です');
}

// ===== ユーザーボタン生成 =====
function generateUserButtons() {
    const container = document.getElementById('user-buttons');
    container.innerHTML = '';

    USERS.forEach(user => {
        const btn = document.createElement('button');
        btn.className = 'user-btn';
        btn.textContent = user; // ログインボタンは「さん」なし
        btn.addEventListener('click', () => login(user));
        container.appendChild(btn);
    });
}

// ===== ログイン/ログアウト =====
function login(user) {
    appState.currentUser = user;
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('main-screen').classList.remove('hidden');
    document.getElementById('current-user').textContent = withSan(user);

    // 画面更新
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
    // ログアウト
    document.getElementById('logout-btn').addEventListener('click', logout);

    // タブ切り替え
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            switchTab(e.target.dataset.tab);
        });
    });

    // ハンディキャップ切り替え（ラジオボタン）
    document.querySelectorAll('input[name="handicap-mode"]').forEach(radio => {
        radio.addEventListener('change', () => {
            updateRankings();
        });
    });

    // フィルター
    document.getElementById('filter-user').addEventListener('change', updateScoresTable);
    document.getElementById('filter-course').addEventListener('change', updateScoresTable);

    // スコア保存（一括入力）
    document.getElementById('save-score-btn').addEventListener('click', saveScore);

    // 新規入力ボタン
    document.getElementById('new-score-btn').addEventListener('click', resetInputForm);

    // 個人スコア保存
    document.getElementById('save-my-score-btn').addEventListener('click', saveMyScore);

    // ハンディキャップ保存
    document.getElementById('save-handicap-btn').addEventListener('click', saveHandicaps);

    // カップ名保存
    document.getElementById('save-cup-name-btn').addEventListener('click', saveCupName);

    // データエクスポート/インポート
    document.getElementById('export-btn').addEventListener('click', exportData);
    document.getElementById('import-btn').addEventListener('click', () => {
        document.getElementById('import-file').click();
    });
    document.getElementById('import-file').addEventListener('change', importData);
}

function switchTab(tabId) {
    // タブボタンの状態更新
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabId);
    });

    // タブコンテンツの表示切り替え
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.toggle('active', content.id === tabId);
    });

    // タブ固有の更新
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
    const data = appState.data;
    const year = appState.currentYear;
    const yearData = data.years[year];

    if (!yearData) return;

    // 有効ラウンド（3名以上参加）のカウント
    const validRounds = yearData.rounds.filter(r => countParticipants(r) >= MIN_PARTICIPANTS);
    document.getElementById('total-rounds').textContent = validRounds.length;

    // 有効参加者（3回以上参加）のカウント
    const participationCounts = getParticipationCounts(yearData.rounds);
    const validParticipants = Object.values(participationCounts).filter(c => c >= MIN_ROUNDS).length;
    document.getElementById('valid-participants').textContent = validParticipants;

    // ベストスコア
    const bestScore = getBestScore(yearData.rounds);
    document.getElementById('best-score-value').textContent = bestScore.score || '-';
    document.getElementById('best-score-holder').textContent = bestScore.user ? withSan(bestScore.user) : '-';

    // パット平均ベスト
    const bestPutt = getBestPuttAverage(yearData.rounds);
    document.getElementById('best-putt-value').textContent = bestPutt.average ? bestPutt.average.toFixed(2) : '-';
    document.getElementById('best-putt-holder').textContent = bestPutt.user ? withSan(bestPutt.user) : '-';

    // 現在のユーザーの成績
    updateMyStats(yearData.rounds);

    // 特別達成
    updateSpecialAchievements(yearData);

    // ダッシュボード用総合ランキング
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
    // ホールインワン
    const hioList = document.getElementById('hole-in-one-list');
    if (yearData.holeInOnes && yearData.holeInOnes.length > 0) {
        hioList.innerHTML = yearData.holeInOnes.map(h =>
            `<li>${withSan(h.user)} - ${h.date} (${h.course} ${h.hole}番ホール)</li>`
        ).join('');
    } else {
        hioList.innerHTML = '<li class="no-data">達成者なし</li>';
    }

    // イーグル
    const eagleList = document.getElementById('eagle-list');
    if (yearData.eagles && yearData.eagles.length > 0) {
        eagleList.innerHTML = yearData.eagles.map(e =>
            `<li>${withSan(e.user)} - ${e.date} (${e.course} ${e.hole}番ホール)</li>`
        ).join('');
    } else {
        eagleList.innerHTML = '<li class="no-data">達成者なし</li>';
    }
}

// ダッシュボード用総合ランキング（ハンディ適用）
function updateDashboardRanking(rounds) {
    const tbody = document.querySelector('#dashboard-overall-ranking tbody');
    if (!tbody) return;

    const validRounds = rounds.filter(r => countParticipants(r) >= MIN_PARTICIPANTS);

    // 各ユーザーの平均スコアを計算（ハンディ適用）
    const rankings = USERS.map(user => {
        const userRounds = validRounds.filter(r => r.scores[user] && r.scores[user].score);
        const scores = userRounds.map(r => {
            let score = r.scores[user].score;
            score -= (appState.data.handicaps[user] || 0);
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
    const data = appState.data;
    const year = appState.currentYear;
    const yearData = data.years[year];

    if (!yearData) return;

    // ラジオボタンから値を取得
    const applyHandicap = document.querySelector('input[name="handicap-mode"]:checked').value === 'with';

    updateOverallRanking(yearData.rounds, applyHandicap);
    updateBestScoreRanking(yearData.rounds, applyHandicap);
    updatePuttRanking(yearData.rounds);
}

function updateOverallRanking(rounds, applyHandicap) {
    const tbody = document.querySelector('#overall-ranking tbody');
    const validRounds = rounds.filter(r => countParticipants(r) >= MIN_PARTICIPANTS);

    // 各ユーザーの平均スコアを計算
    const rankings = USERS.map(user => {
        const userRounds = validRounds.filter(r => r.scores[user] && r.scores[user].score);
        const scores = userRounds.map(r => {
            let score = r.scores[user].score;
            if (applyHandicap) {
                score -= (appState.data.handicaps[user] || 0);
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

    // 全スコアをリスト化
    const allScores = [];
    validRounds.forEach(round => {
        USERS.forEach(user => {
            if (round.scores[user] && round.scores[user].score) {
                let score = round.scores[user].score;
                if (applyHandicap) {
                    score -= (appState.data.handicaps[user] || 0);
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

    // スコア順にソート
    allScores.sort((a, b) => a.score - b.score);

    // 同率順位を計算
    let currentRank = 1;
    let prevScore = null;
    allScores.forEach((s, i) => {
        if (prevScore !== null && s.score !== prevScore) {
            currentRank = i + 1;
        }
        s.rank = currentRank;
        prevScore = s.score;
    });

    // 上位10件を表示
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

    // 各ユーザーの平均パットを計算
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

    // 同率順位を計算
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
    const data = appState.data;
    const year = appState.currentYear;
    const yearData = data.years[year];

    if (!yearData) return;

    // ユーザーフィルター
    const userSelect = document.getElementById('filter-user');
    userSelect.innerHTML = '<option value="all">全員</option>' +
        USERS.map(u => `<option value="${u}">${u}</option>`).join('');

    // コースフィルター
    const courses = [...new Set(yearData.rounds.map(r => r.course))];
    const courseSelect = document.getElementById('filter-course');
    courseSelect.innerHTML = '<option value="all">すべて</option>' +
        courses.map(c => `<option value="${c}">${c}</option>`).join('');

    // 特別達成入力用のユーザー選択
    const hioSelect = document.getElementById('hole-in-one-input');
    const eagleSelect = document.getElementById('eagle-input');
    const userOptions = '<option value="">なし</option>' +
        USERS.map(u => `<option value="${u}">${u}</option>`).join('');
    hioSelect.innerHTML = userOptions;
    eagleSelect.innerHTML = userOptions;
}

function updateScoresTable() {
    const data = appState.data;
    const year = appState.currentYear;
    const yearData = data.years[year];

    if (!yearData) return;

    const filterUser = document.getElementById('filter-user').value;
    const filterCourse = document.getElementById('filter-course').value;

    let rounds = [...yearData.rounds];

    // フィルタリング
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
    const currentUser = appState.currentUser;
    const yearSelect = document.getElementById('input-year');

    // 編集モードの場合
    if (appState.editingRound !== null) {
        const editYear = appState.editingYear || appState.currentYear;
        const round = appState.data.years[editYear].rounds[appState.editingRound];
        document.getElementById('bulk-input-title').textContent = `${editYear}年 第${round.roundNumber}回 スコア編集`;
        yearSelect.value = editYear;
        yearSelect.disabled = true; // 編集時は年度変更不可
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
        // 新規入力モード
        document.getElementById('bulk-input-title').textContent = '全員のスコアを一括入力';
        yearSelect.disabled = false;
        // 日付から年度を自動設定
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

    // ログインユーザー名を表示
    document.getElementById('my-input-user').textContent = user;

    // 今日の日付を設定
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    document.getElementById('my-input-date').value = todayStr;
    document.getElementById('my-input-year').value = today.getFullYear().toString();

    // 最近のスコアを表示
    updateMyRecentScores();
}

function updateMyRecentScores() {
    const user = appState.currentUser;
    const container = document.getElementById('my-recent-scores');

    // 全年度から自分のスコアを収集
    const myScores = [];
    Object.entries(appState.data.years).forEach(([year, yearData]) => {
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
    });

    // 日付で降順ソート
    myScores.sort((a, b) => new Date(b.date) - new Date(a.date));

    // 最新5件を表示
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

function saveMyScore() {
    const user = appState.currentUser;
    const date = document.getElementById('my-input-date').value;
    const course = document.getElementById('my-input-course').value;
    const score = parseInt(document.getElementById('my-input-score').value);
    const putt = parseInt(document.getElementById('my-input-putt').value);
    const selectedYear = document.getElementById('my-input-year').value;

    if (!date || !course) {
        alert('日付とコースを入力してください');
        return;
    }

    if (!score) {
        alert('スコアを入力してください');
        return;
    }

    // 指定年度のデータがなければ作成
    if (!appState.data.years[selectedYear]) {
        appState.data.years[selectedYear] = { rounds: [], holeInOnes: [], eagles: [] };
    }

    const yearData = appState.data.years[selectedYear];

    // 同じ日付・コースのラウンドを検索
    let existingRound = yearData.rounds.find(r => r.date === date && r.course === course);

    if (existingRound) {
        // 既存ラウンドにスコアを追加/更新
        existingRound.scores[user] = { score };
        if (putt) existingRound.scores[user].putt = putt;
        alert('スコアを更新しました');
    } else {
        // 新規ラウンドを作成
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

    saveData();

    // フォームリセット
    document.getElementById('my-input-course').value = '';
    document.getElementById('my-input-score').value = '';
    document.getElementById('my-input-putt').value = '';

    // 画面更新
    updateAllViews();
}

// ===== コースリスト更新 =====
function updateCourseDatalist() {
    const datalist = document.getElementById('course-list');
    if (!datalist) return;

    // 全年度からコース名を収集
    const courses = new Set();
    Object.values(appState.data.years).forEach(yearData => {
        yearData.rounds.forEach(round => {
            if (round.course) courses.add(round.course);
        });
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
    appState.editingYear = year || appState.currentYear;
    switchTab('bulk-input');
}

function deleteRound() {
    if (appState.editingRound === null) return;

    if (!confirm('このラウンドを削除しますか？')) return;

    const year = appState.editingYear || appState.currentYear;
    appState.data.years[year].rounds.splice(appState.editingRound, 1);

    // ラウンド番号を振り直す
    appState.data.years[year].rounds.forEach((round, i) => {
        round.roundNumber = i + 1;
    });

    saveData();
    appState.editingRound = null;
    appState.editingYear = null;
    alert('ラウンドを削除しました');
    updateAllViews();
    switchTab('scores');
}

function saveScore() {
    const date = document.getElementById('input-date').value;
    const course = document.getElementById('input-course').value;
    const selectedYear = document.getElementById('input-year').value;

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

    // 参加人数チェック
    const participants = Object.keys(scores).length;
    if (participants < MIN_PARTICIPANTS) {
        const proceed = confirm(`参加者が${participants}名です。有効なラウンドは${MIN_PARTICIPANTS}名以上必要です。それでも保存しますか？`);
        if (!proceed) return;
    }

    // 編集時は編集中の年度、新規時は選択された年度を使用
    const year = appState.editingRound !== null
        ? (appState.editingYear || appState.currentYear)
        : selectedYear;

    if (!appState.data.years[year]) {
        appState.data.years[year] = { rounds: [], holeInOnes: [], eagles: [] };
    }

    if (appState.editingRound !== null) {
        // 編集モード
        const round = appState.data.years[year].rounds[appState.editingRound];
        round.date = date;
        round.course = course;
        round.scores = scores;
        alert('スコアを更新しました');
    } else {
        // 新規追加
        const roundNumber = appState.data.years[year].rounds.length + 1;

        const newRound = {
            roundNumber,
            date,
            course,
            scores
        };

        appState.data.years[year].rounds.push(newRound);

        // 特別達成の記録
        const hioUser = document.getElementById('hole-in-one-input').value;
        const hioHole = document.getElementById('hole-in-one-hole').value;
        if (hioUser && hioHole) {
            appState.data.years[year].holeInOnes.push({
                user: hioUser,
                date,
                course,
                hole: parseInt(hioHole)
            });
        }

        const eagleUser = document.getElementById('eagle-input').value;
        const eagleHole = document.getElementById('eagle-hole').value;
        if (eagleUser && eagleHole) {
            appState.data.years[year].eagles.push({
                user: eagleUser,
                date,
                course,
                hole: parseInt(eagleHole)
            });
        }

        alert(`${year}年のスコアを保存しました`);
    }

    saveData();

    // フォームリセット
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

    // 画面更新
    updateAllViews();
}

// ===== ハンディキャップ =====
function setupHandicapSettings() {
    const container = document.getElementById('handicap-settings');
    container.innerHTML = USERS.map(user => `
        <div class="handicap-item">
            <label>${user}</label>
            <input type="number" id="handicap-${user}" value="${appState.data.handicaps[user] || 0}" min="0" max="50">
        </div>
    `).join('');
}

function saveHandicaps() {
    USERS.forEach(user => {
        const value = parseInt(document.getElementById(`handicap-${user}`).value) || 0;
        appState.data.handicaps[user] = value;
    });

    saveData();
    alert('ハンディキャップを保存しました');
    updateRankings();
}

// ===== カップ名設定 =====
function getCupName() {
    const year = appState.currentYear;
    // 年度ごとのカップ名を取得（設定されていない場合はデフォルト値）
    if (appState.data.cupNames && appState.data.cupNames[year]) {
        return appState.data.cupNames[year];
    }
    // デフォルトのカップ名
    return '松本杯';
}

function updateCupName() {
    const year = appState.currentYear;
    const cupName = getCupName();

    // ヘッダーのタイトルを更新
    document.getElementById('cup-title').textContent = `${year}${cupName}`;

    // ログイン画面のタイトルも更新
    const loginTitle = document.querySelector('.login-container h1');
    if (loginTitle) {
        loginTitle.textContent = cupName;
    }

    // ページタイトルも更新
    document.title = `${cupName} ゴルフスコア管理`;
}

function setupCupNameSettings() {
    const cupName = getCupName();
    const input = document.getElementById('cup-name-input');
    if (input) {
        input.value = cupName;
    }
}

function saveCupName() {
    const input = document.getElementById('cup-name-input');
    const cupName = input.value.trim();

    if (!cupName) {
        alert('カップ名を入力してください');
        return;
    }

    const year = appState.currentYear;

    // cupNamesオブジェクトがなければ作成
    if (!appState.data.cupNames) {
        appState.data.cupNames = {};
    }

    appState.data.cupNames[year] = cupName;
    saveData();
    updateCupName();
    alert('カップ名を保存しました');
}

// ===== データエクスポート/インポート =====
function exportData() {
    const dataStr = JSON.stringify(appState.data, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `golf-score-${appState.currentYear}.json`;
    a.click();

    URL.revokeObjectURL(url);
}

function importData(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            const importedData = JSON.parse(event.target.result);

            // データの妥当性チェック（簡易）
            if (!importedData.years || !importedData.handicaps) {
                throw new Error('無効なデータ形式です');
            }

            const proceed = confirm('現在のデータを上書きしてインポートしますか？');
            if (proceed) {
                appState.data = importedData;
                saveData();
                updateAllViews();
                alert('データをインポートしました');
            }
        } catch (error) {
            alert('データのインポートに失敗しました: ' + error.message);
        }
    };
    reader.readAsText(file);

    // ファイル選択をリセット
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

    // 3回以上参加者のみ対象
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

    // 3回以上参加者のみ対象
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
