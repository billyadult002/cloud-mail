import crypto from 'node:crypto';

const base = process.env.BASE || 'https://cloud-mail.fastonegroup.workers.dev';
const code = process.env.REGISTRATION_CODE;
if (!code) throw new Error('REGISTRATION_CODE is required');

const stamp = Date.now();
const sender = process.env.SENDER_EMAIL || `cloudmail.sender.${stamp}@fastonegroup.com`;
const recipient = process.env.RECIPIENT_EMAIL || `cloudmail.recipient.${stamp}@fastonegroup.com`;
const password = process.env.TEST_PASSWORD || `CloudMail#Mail-${stamp}`;
const subject = `CloudMail mail E2E ${stamp}`;
const attachmentText = `CloudMail attachment E2E ${stamp}`;
const attachmentBase64 = Buffer.from(attachmentText).toString('base64');

async function api(path, options = {}) {
	const response = await fetch(`${base}/api${path}`, {
		...options,
		headers: { 'content-type': 'application/json', ...(options.headers || {}) }
	});
	const body = await response.json();
	if (body.code !== 200) throw new Error(`${path}: ${JSON.stringify(body)}`);
	return body.data;
}

async function register(email) {
	if (process.env.SKIP_REGISTER !== '1') {
		await api('/register', {
			method: 'POST',
			body: JSON.stringify({ email, password, code, token: '' })
		});
	}
	const login = await api('/login', {
		method: 'POST',
		body: JSON.stringify({ email, password })
	});
	return login.token;
}

const senderToken = await register(sender);
const recipientToken = await register(recipient);
const senderAccounts = await api('/account/list?accountId=0&size=30&lastSort=9999999999', {
	headers: { authorization: senderToken }
});
const senderAccount = senderAccounts.find(account => account.email === sender);
if (!senderAccount) throw new Error('Sender account unavailable');

await api('/email/send', {
	method: 'POST',
	headers: { authorization: senderToken },
	body: JSON.stringify({
		accountId: senderAccount.accountId,
		name: 'CloudMail E2E',
		sendType: '',
		emailId: 0,
		receiveEmail: [recipient],
		text: 'CloudMail internal delivery verification.',
		content: '<p>CloudMail internal delivery verification.</p>',
		subject,
		attachments: [{
			content: attachmentBase64,
			filename: 'cloudmail-e2e.txt',
			type: 'text/plain'
		}]
	})
});

const messages = await api('/email/list?allReceive=1&size=30&type=0&timeSort=0', {
	headers: { authorization: recipientToken }
});
const messageList = Array.isArray(messages) ? messages : messages.list;
const received = messageList.find(message => message.subject === subject);
if (!received) throw new Error('Recipient did not receive the message');

const attachments = await api(`/email/attList?emailId=${received.emailId}`, {
	headers: { authorization: recipientToken }
});
const attachment = attachments.find(item => item.filename === 'cloudmail-e2e.txt');
if (!attachment?.key) throw new Error('Recipient attachment metadata unavailable');

const download = await fetch(`${base}/api/oss/${attachment.key}`, {
	headers: { authorization: recipientToken }
});
if (!download.ok) throw new Error(`Attachment download HTTP ${download.status}`);
const downloaded = Buffer.from(await download.arrayBuffer());
const expectedHash = crypto.createHash('sha256').update(attachmentText).digest('hex');
const actualHash = crypto.createHash('sha256').update(downloaded).digest('hex');
if (actualHash !== expectedHash) throw new Error('Attachment hash mismatch');

console.log(JSON.stringify({
	sendMail: true,
	receiveMail: true,
	attachmentUploadR2: true,
	attachmentDownloadR2: true,
	attachmentHashMatched: true,
	subject,
	sender,
	recipient
}, null, 2));
