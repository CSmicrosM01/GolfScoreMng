// Lambda関数: ゴルフスコアデータをS3に保存（年度別ファイル対応版）
// 注意: CORSは関数URLの設定で行うため、コード内ではCORSヘッダーを設定しない
import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';

const s3Client = new S3Client({ region: process.env.AWS_REGION });
const BUCKET_NAME = process.env.BUCKET_NAME;
const CONFIG_FILE_KEY = 'config.json';

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
        if (method === 'GET') {
            // アクション別の処理
            if (action === 'config') {
                // 設定ファイルを取得
                const config = await getConfig();
                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify(config)
                };
            } else if (action === 'years') {
                // 利用可能な年度一覧を取得
                const years = await getAvailableYears();
                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({ years })
                };
            } else if (year) {
                // 特定年度のデータを取得
                const data = await getYearData(year);
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
            if (event.isBase64Encoded) {
                bodyData = JSON.parse(Buffer.from(event.body, 'base64').toString('utf-8'));
            } else {
                bodyData = JSON.parse(event.body);
            }

            if (action === 'config') {
                // 設定ファイルを保存
                await saveConfig(bodyData);
                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({ message: '設定を保存しました' })
                };
            } else if (bodyData.year) {
                // 年度別データを保存
                const yearToSave = bodyData.year;
                await saveYearData(yearToSave, bodyData);

                // config.jsonのavailableYearsを更新
                await updateAvailableYears(yearToSave);

                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({ message: `${yearToSave}年のデータを保存しました` })
                };
            } else {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: '年度が指定されていません' })
                };
            }
        }

        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: '不正なリクエストです' })
        };
    } catch (error) {
        console.error('Error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: error.message })
        };
    }
};

// 設定ファイルを取得
async function getConfig() {
    try {
        const command = new GetObjectCommand({
            Bucket: BUCKET_NAME,
            Key: CONFIG_FILE_KEY
        });
        const response = await s3Client.send(command);
        const data = await response.Body.transformToString();
        return JSON.parse(data);
    } catch (error) {
        if (error.name === 'NoSuchKey') {
            // 設定ファイルがない場合はデフォルト値を返す
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
        throw error;
    }
}

// 設定ファイルを保存
async function saveConfig(config) {
    const command = new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: CONFIG_FILE_KEY,
        Body: JSON.stringify(config, null, 2),
        ContentType: 'application/json'
    });
    await s3Client.send(command);
}

// 利用可能な年度一覧を取得
async function getAvailableYears() {
    try {
        const command = new ListObjectsV2Command({
            Bucket: BUCKET_NAME,
            Prefix: 'data-'
        });
        const response = await s3Client.send(command);

        const years = [];
        if (response.Contents) {
            response.Contents.forEach(obj => {
                const match = obj.Key.match(/^data-(\d{4})\.json$/);
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
async function getYearData(year) {
    try {
        const command = new GetObjectCommand({
            Bucket: BUCKET_NAME,
            Key: `data-${year}.json`
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
                cupName: "松本杯"
            };
        }
        throw error;
    }
}

// 年度別データを保存
async function saveYearData(year, data) {
    const command = new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: `data-${year}.json`,
        Body: JSON.stringify(data, null, 2),
        ContentType: 'application/json'
    });
    await s3Client.send(command);
}

// config.jsonのavailableYearsを更新
async function updateAvailableYears(year) {
    const config = await getConfig();
    const yearNum = parseInt(year);

    if (!config.availableYears.includes(yearNum)) {
        config.availableYears.push(yearNum);
        config.availableYears.sort((a, b) => a - b);
        await saveConfig(config);
    }
}
