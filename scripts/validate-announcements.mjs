import fs from 'node:fs';

const announcementsPath = 'deploy/announcements.json';
const payload = JSON.parse(fs.readFileSync(announcementsPath, 'utf8'));

if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
  throw new Error('deploy/announcements.json must be an object.');
}

if (!Array.isArray(payload.announcements)) {
  throw new Error('deploy/announcements.json must contain an announcements array.');
}

for (const [index, item] of payload.announcements.entries()) {
  if (!item || typeof item !== 'object') {
    throw new Error(`Announcement ${index} must be an object.`);
  }

  for (const key of ['id', 'publishedAt', 'level', 'url']) {
    if (typeof item[key] !== 'string' || item[key].length === 0) {
      throw new Error(`Announcement ${index} is missing ${key}.`);
    }
  }

  if (!item.title || typeof item.title.tr !== 'string' || typeof item.title.en !== 'string') {
    throw new Error(`Announcement ${index} must contain title.tr and title.en.`);
  }

  if (!item.body || typeof item.body.tr !== 'string' || typeof item.body.en !== 'string') {
    throw new Error(`Announcement ${index} must contain body.tr and body.en.`);
  }
}

console.log(`Validated ${payload.announcements.length} announcement(s).`);
