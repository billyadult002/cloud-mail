import s3Service from './s3-service';
import settingService from './setting-service';
import kvObjService from './kv-obj-service';

const r2Service = {

	async storageType(c) {

		const setting = await settingService.query(c);
		const { bucket, endpoint, s3AccessKey, s3SecretKey } = setting;

		if (!!(bucket && endpoint && s3AccessKey && s3SecretKey)) {
			return 'S3';
		}

		if (c.env.r2) {
			return 'R2';
		}

		return 'KV';
	},

	async putObj(c, key, content, metadata) {

		const storageType = await this.storageType(c);

		if (storageType === 'KV') {
			await kvObjService.putObj(c, key, content, metadata);
		}

		if (storageType === 'R2') {
			await c.env.r2.put(key, content, {
				httpMetadata: { ...metadata }
			});
		}

		if (storageType === 'S3') {
			await s3Service.putObj(c, key, content, metadata);
		}

	},

	async getObj(c, key) {
		const storageType = await this.storageType(c);

		if (storageType === 'KV') {
			return await kvObjService.getObj(c, key);
		}

		if (storageType === 'R2') {
			return await c.env.r2.get(key);
		}

		if (storageType === 'S3') {
			return await s3Service.getObj(c, key);
		}
	},

	async toObjResp(c, key) {
		const obj = await this.getObj(c, key);
		if (!obj) {
			return new Response('Not found', {
				status: 404,
				headers: {
					'Cache-Control': 'no-store',
					'X-Content-Type-Options': 'nosniff'
				}
			});
		}

		if (obj instanceof Response) {
			return obj;
		}

		const headers = new Headers();
		headers.set('Content-Type', obj.httpMetadata?.contentType || 'application/octet-stream');
		if (obj.httpMetadata?.contentDisposition) {
			headers.set('Content-Disposition', obj.httpMetadata.contentDisposition);
		}
		if (obj.httpMetadata?.cacheControl) {
			headers.set('Cache-Control', obj.httpMetadata.cacheControl);
		}
		headers.set('X-Content-Type-Options', 'nosniff');

		return new Response(obj.body, { headers });
	},

	async delete(c, key) {

		const storageType = await this.storageType(c);

		if (storageType === 'KV') {
			await kvObjService.deleteObj(c, key);
		}

		if (storageType === 'R2') {
			await c.env.r2.delete(key);
		}

		if (storageType === 'S3'){
			await s3Service.deleteObj(c, key);
		}

	}

};
export default r2Service;
