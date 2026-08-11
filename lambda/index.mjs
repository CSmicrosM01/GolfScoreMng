// Lambda関数: ゴルフスコアデータをS3に保存（年度別ファイル対応版）
// 注意: CORSは関数URLの設定で行うため、コード内ではCORSヘッダーを設定しない
import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';

const s3Client = new S3Client({ region: process.env.AWS_REGION });
const BUCKET_NAME = process.env.BUCKET_NAME;
const CONFIG_FILE_KEY = 'config.json';

// グループ別データ分離: group パラメータ指定時は S3 キーに「{group}/」プレフィックスを付け、
// 既存データ(バケット直下)と競合しない別ファイルを読み書きする。
// 例: group=kondo → kondo/config.json, kondo/data-2026.json
// group 未指定時は従来どおり(後方互換)。
const GROUP_NAME_PATTERN = /^[a-z0-9-]{1,20}$/;

// グループ別のデフォルト設定(データファイル未作成時の初期値)
const GROUP_DEFAULTS = {
    '': {
        cupName: '正本杯',
        handicaps: { "松本": 0, "正本": 0, "渡邉": 0, "近藤": 0, "比企": 0, "内藤": 0 }
    },
    'kondo': {
        cupName: '近藤杯',
        handicaps: { "近藤": 0, "鹿中": 0 }
    }
};

function resolveGroup(queryParams) {
    const group = queryParams.group || '';
    if (group && !GROUP_NAME_PATTERN.test(group)) {
        throw Object.assign(new Error('不正なグループ名です'), { statusCode: 400 });
    }
    return group;
}

function keyPrefix(group) {
    return group ? `${group}/` : '';
}

function groupDefaults(group) {
    return GROUP_DEFAULTS[group] || GROUP_DEFAULTS[''];
}

export const handler = async (event) => {
    // レスポンスヘッダー（CORSは関数URL設定で管理）
    const headers = {
        'Content-Type': 'application/json'
    };

    // 関数URLの場合はrequestContext.http.methodを使用
    const method = event.requestContext?.http?.method || event.httpMethod;

    // クエリパラメータを取得
    const queryParams = event.queryStringParameters || {};
    const year = queryParams.year;
    const action = queryParams.action; // 'config', 'years', 'data'

    try {
        // グループ(データ分離用プレフィックス)。未指定なら従来動作
        const group = resolveGroup(queryParams);

        if (method === 'GET') {
            // アクション別の処理
            if (action === 'config') {
                // 設定ファイルを取得
                const config = await getConfig(group);
                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify(config)
                };
            } else if (action === 'years') {
                // 利用可能な年度一覧を取得
                const years = await getAvailableYears(group);
                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({ years })
                };
            } else if (year) {
                // 特定年度のデータを取得
                const data = await getYearData(year, group);
                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify(data)
                };
            } else {
                // 年度指定なしの場合はエラー
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: '年度を指定してください（?year=2025）' })
                };
            }
        } else if (method === 'POST') {
            // データ保存（関数URLの場合、bodyはbase64エンコードされている可能性）
            let bodyData;
            try {
                if (event.isBase64Encoded) {
                    bodyData = JSON.parse(Buffer.from(event.body, 'base64').toString('utf-8'));
                } else {
                    bodyData = JSON.parse(event.body);
                }
            } catch (parseError) {
                console.error('JSON解析エラー:', parseError);
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: 'JSONデータの解析に失敗しました', details: parseError.message })
                };
            }

            if (action === 'config') {
                // 設定ファイルを保存
                await saveConfig(bodyData, group);
                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({ message: '設定を保存しました' })
                };
            } else if (bodyData.year) {
                // 年度別データを保存
                const yearToSave = bodyData.year;
                console.log(`年度データ保存開始: ${yearToSave}`, JSON.stringify(bodyData).substring(0, 200));

                // replaceMode: true の場合はマージせずに上書き（削除操作用）
                if (bodyData.replaceMode) {
                    await saveYearDataDirect(yearToSave, bodyData, group);
                } else {
                    await saveYearData(yearToSave, bodyData, group);
                }

                // config.jsonのavailableYearsを更新
                await updateAvailableYears(yearToSave, group);

                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({ message: `${yearToSave}年のデータを保存しました` })
                };
            } else {
                console.error('年度プロパティがありません:', bodyData);
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: '年度が指定されていません', receivedKeys: Object.keys(bodyData) })
                };
            }
        }

        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: '不正なリクエストです' })
        };
    } catch (error) {
        console.error('Lambda実行エラー:', error);
        console.error('エラースタック:', error.stack);
        if (error.statusCode === 400) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: error.message })
            };
        }
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: error.message,
                errorType: error.name,
                stack: error.stack
            })
        };
    }
};

// 設定ファイルを取得
async function getConfig(group = '') {
    try {
        const command = new GetObjectCommand({
            Bucket: BUCKET_NAME,
            Key: `${keyPrefix(group)}${CONFIG_FILE_KEY}`
        });
        const response = await s3Client.send(command);
        const data = await response.Body.transformToString();
        return JSON.parse(data);
    } catch (error) {
        if (error.name === 'NoSuchKey') {
            // 設定ファイルがない場合はデフォルト値を返す
            return {
                availableYears: [],
                handicaps: { ...groupDefaults(group).handicaps }
            };
        }
        throw error;
    }
}

// 設定ファイルを保存
async function saveConfig(config, group = '') {
    const command = new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: `${keyPrefix(group)}${CONFIG_FILE_KEY}`,
        Body: JSON.stringify(config, null, 2),
        ContentType: 'application/json'
    });
    await s3Client.send(command);
}

// 利用可能な年度一覧を取得
async function getAvailableYears(group = '') {
    try {
        const prefix = keyPrefix(group);
        const command = new ListObjectsV2Command({
            Bucket: BUCKET_NAME,
            Prefix: `${prefix}data-`
        });
        const response = await s3Client.send(command);

        const years = [];
        const pattern = new RegExp(`^${prefix}data-(\\d{4})\\.json$`);
        if (response.Contents) {
            response.Contents.forEach(obj => {
                const match = obj.Key.match(pattern);
                if (match) {
                    years.push(parseInt(match[1]));
                }
            });
        }

        return years.sort((a, b) => a - b);
    } catch (error) {
        console.error('Error listing years:', error);
        return [];
    }
}

// 特定年度のデータを取得
async function getYearData(year, group = '') {
    try {
        const command = new GetObjectCommand({
            Bucket: BUCKET_NAME,
            Key: `${keyPrefix(group)}data-${year}.json`
        });
        const response = await s3Client.send(command);
        const data = await response.Body.transformToString();
        return JSON.parse(data);
    } catch (error) {
        if (error.name === 'NoSuchKey') {
            // ファイルがない場合は空のデータを返す
            return {
                year: parseInt(year),
                rounds: [],
                holeInOnes: [],
                eagles: [],
                albatrosses: [],
                cupName: groupDefaults(group).cupName
            };
        }
        throw error;
    }
}

// 年度別データを保存（既存データとマージ）
async function saveYearData(year, newData, group = '') {
    // 既存データを取得
    let existingData = await getYearData(year, group);

    // deleteRound が指定されている場合、既存データから該当ラウンドを削除
    // （コース名変更時に古いラウンドが残らないようにする）
    if (newData.deleteRound) {
        const { date, course } = newData.deleteRound;
        if (existingData.rounds) {
            existingData.rounds = existingData.rounds.filter(
                r => !(r.date === date && r.course === course)
            );
        }
        console.log(`削除対象ラウンド: ${date}_${course}`);
    }

    // deleteRound プロパティを除去してからマージ
    const dataToMerge = { ...newData };
    delete dataToMerge.deleteRound;

    // データをマージ
    const mergedData = mergeYearData(existingData, dataToMerge, group);

    const command = new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: `${keyPrefix(group)}data-${year}.json`,
        Body: JSON.stringify(mergedData, null, 2),
        ContentType: 'application/json'
    });
    await s3Client.send(command);
}

// 年度別データを直接保存（マージなし、削除操作用）
async function saveYearDataDirect(year, data, group = '') {
    // replaceModeプロパティを除去して保存
    const saveData = { ...data };
    delete saveData.replaceMode;

    const command = new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: `${keyPrefix(group)}data-${year}.json`,
        Body: JSON.stringify(saveData, null, 2),
        ContentType: 'application/json'
    });
    await s3Client.send(command);
}

// 年度データをマージ（既存データを保持しつつ新データを追加・更新）
function mergeYearData(existingData, newData, group = '') {
    const merged = {
        year: newData.year || existingData.year,
        rounds: [],
        holeInOnes: existingData.holeInOnes || [],
        eagles: existingData.eagles || [],
        albatrosses: existingData.albatrosses || [],
        cupName: newData.cupName || existingData.cupName || groupDefaults(group).cupName
    };

    // ラウンドデータをマージ
    // 既存のラウンドをマップに格納（日付+コースをキーとする）
    const roundMap = new Map();

    // 既存データを先に追加
    if (existingData.rounds) {
        existingData.rounds.forEach(round => {
            const key = `${round.date}_${round.course}`;
            roundMap.set(key, { ...round });
        });
    }

    // 新データをマージ（同じ日付+コースなら各ユーザーのスコアをマージ）
    if (newData.rounds) {
        newData.rounds.forEach(newRound => {
            const key = `${newRound.date}_${newRound.course}`;

            if (roundMap.has(key)) {
                // 既存ラウンドがある場合、スコアをマージ
                const existingRound = roundMap.get(key);
                existingRound.scores = {
                    ...existingRound.scores,
                    ...newRound.scores
                };
                roundMap.set(key, existingRound);
            } else {
                // 新規ラウンド
                roundMap.set(key, { ...newRound });
            }
        });
    }

    // マップから配列に変換し、日付でソート
    merged.rounds = Array.from(roundMap.values())
        .sort((a, b) => a.date.localeCompare(b.date));

    // ラウンド番号を振り直す
    merged.rounds.forEach((round, index) => {
        round.roundNumber = index + 1;
    });

    // ホールインワン、イーグル、アルバトロスをマージ（重複除去）
    if (newData.holeInOnes) {
        merged.holeInOnes = mergeAchievements(existingData.holeInOnes || [], newData.holeInOnes);
    }
    if (newData.eagles) {
        merged.eagles = mergeAchievements(existingData.eagles || [], newData.eagles);
    }
    if (newData.albatrosses) {
        merged.albatrosses = mergeAchievements(existingData.albatrosses || [], newData.albatrosses);
    }

    return merged;
}

// 達成記録をマージ（重複除去）
function mergeAchievements(existing, newItems) {
    const achievementMap = new Map();

    // キーを生成する関数
    const getKey = (item) => `${item.user}_${item.date}_${item.course}_${item.hole}`;

    // 既存データを追加
    existing.forEach(item => {
        achievementMap.set(getKey(item), item);
    });

    // 新データを追加（重複は上書き）
    newItems.forEach(item => {
        achievementMap.set(getKey(item), item);
    });

    return Array.from(achievementMap.values());
}

// config.jsonのavailableYearsを更新
async function updateAvailableYears(year, group = '') {
    const config = await getConfig(group);
    const yearNum = parseInt(year);

    if (!config.availableYears.includes(yearNum)) {
        config.availableYears.push(yearNum);
        config.availableYears.sort((a, b) => a - b);
        await saveConfig(config, group);
    }
}
