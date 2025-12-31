// Lambda関数: ゴルフスコアデータをS3に保存（関数URL対応版）
// 注意: CORSは関数URLの設定で行うため、コード内ではCORSヘッダーを設定しない
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';

const s3Client = new S3Client({ region: process.env.AWS_REGION });
const BUCKET_NAME = process.env.BUCKET_NAME;
const DATA_FILE_KEY = 'data.json';

export const handler = async (event) => {
    // レスポンスヘッダー（CORSは関数URL設定で管理）
    const headers = {
        'Content-Type': 'application/json'
    };

    // 関数URLの場合はrequestContext.http.methodを使用
    const method = event.requestContext?.http?.method || event.httpMethod;

    try {
        if (method === 'GET') {
            // データ取得
            const command = new GetObjectCommand({
                Bucket: BUCKET_NAME,
                Key: DATA_FILE_KEY
            });

            const response = await s3Client.send(command);
            const data = await response.Body.transformToString();

            return {
                statusCode: 200,
                headers,
                body: data
            };
        } else if (method === 'POST') {
            // データ保存（関数URLの場合、bodyはbase64エンコードされている可能性）
            let bodyData;
            if (event.isBase64Encoded) {
                bodyData = JSON.parse(Buffer.from(event.body, 'base64').toString('utf-8'));
            } else {
                bodyData = JSON.parse(event.body);
            }

            const command = new PutObjectCommand({
                Bucket: BUCKET_NAME,
                Key: DATA_FILE_KEY,
                Body: JSON.stringify(bodyData, null, 2),
                ContentType: 'application/json'
            });

            await s3Client.send(command);

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({ message: 'データを保存しました' })
            };
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
