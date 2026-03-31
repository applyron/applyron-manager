/**
 * Semantic Release Configuration
 *
 * This configuration uses the specific release rules requested by the user,
 * but adapts the plugin configuration to work with standard Conventional Commits
 * instead of Gitmoji (since the project history doesn't use emojis).
 */

const DEFAULT_REPO_OWNER = 'applyron';
const DEFAULT_REPO_NAME = 'applyron-manager';
const resolvedRepoOwner = process.env.APPLYRON_GITHUB_OWNER || DEFAULT_REPO_OWNER;
const resolvedRepoName = process.env.APPLYRON_GITHUB_REPO || DEFAULT_REPO_NAME;
const REPO_URL =
  process.env.APPLYRON_RELEASE_REPO_URL ||
  `https://github.com/${resolvedRepoOwner}/${resolvedRepoName}`;
const GITHUB_BASE_URL = 'https://github.com';
const FULL_CHANGELOG_URL = `${REPO_URL}/blob/main/CHANGELOG.md`;

const releaseRules = [
  {
    release: 'minor',
    type: 'feat',
  },
  {
    release: 'patch',
    type: 'fix',
  },
  {
    release: 'patch',
    type: 'perf',
  },
  {
    release: 'patch',
    type: 'style',
  },
  {
    release: 'patch',
    type: 'refactor',
  },
  {
    release: 'patch',
    type: 'build',
  },
  { release: 'patch', scope: 'README', type: 'docs' },
  { release: 'patch', scope: 'README.md', type: 'docs' },
  { release: false, type: 'docs' },
  {
    release: false,
    type: 'test',
  },
  {
    release: false,
    type: 'ci',
  },
  {
    release: false,
    type: 'chore',
  },
  {
    release: false,
    type: 'wip',
  },
  {
    release: 'major',
    type: 'BREAKING CHANGE',
  },
  {
    release: 'major',
    scope: 'BREAKING CHANGE',
  },
  {
    release: 'major',
    subject: '*BREAKING CHANGE*',
  },
  { release: 'patch', subject: '*force release*' },
  { release: 'patch', subject: '*force patch*' },
  { release: 'minor', subject: '*force minor*' },
  { release: 'major', subject: '*force major*' },
  { release: false, subject: '*skip release*' },
];

const getGithubUsernameFromEmail = (email) => {
  if (!email) {
    return undefined;
  }

  const match = email.match(/^(?:\d+\+)?(?<username>[a-z0-9-]+)@users\.noreply\.github\.com$/i);

  return match?.groups?.username;
};

const isBotIdentity = (value) => {
  return typeof value === 'string' && /bot/i.test(value);
};

const buildReleaseFooter = (commits) => {
  const mergedPullRequests = new Map();
  const contributors = new Map();

  (commits || []).forEach((commit) => {
    const message = [commit?.message, commit?.subject, commit?.header].filter(Boolean).join('\n');
    if (message) {
      const mergeMatches = message.match(/pull request #(?<number>\d+)/gi);
      if (mergeMatches) {
        mergeMatches.forEach((match) => {
          const number = match.replace(/\D/g, '');
          if (number) {
            mergedPullRequests.set(number, {
              number,
              url: REPO_URL ? `${REPO_URL}/pull/${number}` : null,
            });
          }
        });
      }

      const squashMatches = message.match(/\(#(?<number>\d+)\)/g);
      if (squashMatches) {
        squashMatches.forEach((match) => {
          const number = match.replace(/\D/g, '');
          if (number) {
            mergedPullRequests.set(number, {
              number,
              url: REPO_URL ? `${REPO_URL}/pull/${number}` : null,
            });
          }
        });
      }
    }

    const author = commit?.author || commit?.committer;
    const username = getGithubUsernameFromEmail(author?.email);
    const displayName = username ? `@${username}` : author?.name;

    if (!displayName || isBotIdentity(displayName)) {
      return;
    }

    if (username && isBotIdentity(username)) {
      return;
    }

    contributors.set(username || displayName, {
      name: displayName,
      url: username ? `${GITHUB_BASE_URL}/${username}` : undefined,
    });
  });

  const footerLines = [];
  const sortedPullRequests = Array.from(mergedPullRequests.values()).sort(
    (left, right) => Number(left.number) - Number(right.number),
  );
  if (sortedPullRequests.length > 0) {
    footerLines.push('### 🔀 Merged Pull Requests');
    sortedPullRequests.forEach((pullRequest) => {
      footerLines.push(
        pullRequest.url
          ? `- [#${pullRequest.number}](${pullRequest.url})`
          : `- #${pullRequest.number}`,
      );
    });
    footerLines.push('');
  }

  const sortedContributors = Array.from(contributors.values()).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  if (sortedContributors.length > 0) {
    footerLines.push('### 🙌 Contributors');
    sortedContributors.forEach((contributor) => {
      if (contributor.url) {
        footerLines.push(`- [${contributor.name}](${contributor.url})`);
        return;
      }

      footerLines.push(`- ${contributor.name}`);
    });
    footerLines.push('');
  }

  if (FULL_CHANGELOG_URL) {
    footerLines.push(`Full Changelog: ${FULL_CHANGELOG_URL}`);
  }

  return footerLines.join('\n');
};

const appendReleaseNotes = (notes, commits) => {
  const trimmedNotes = (notes || '').trimEnd();
  const footer = buildReleaseFooter(commits);

  if (!footer) {
    return trimmedNotes;
  }

  return `${trimmedNotes}\n\n${footer}`;
};

const appendReleaseNotesPlugin = {
  publish: async (pluginConfig, context) => {
    if (!context?.nextRelease?.notes) {
      return;
    }

    context.nextRelease.notes = appendReleaseNotes(context.nextRelease.notes, context.commits);
  },
};

const releaseConfig = {
  branches: ['main', { name: 'beta', prerelease: true }],
  plugins: [
    [
      '@semantic-release/commit-analyzer',
      {
        preset: 'conventionalcommits',
        releaseRules: releaseRules,
      },
    ],
    [
      '@semantic-release/release-notes-generator',
      {
        preset: 'conventionalcommits',
        presetConfig: {
          types: [
            { type: 'feat', section: '✨ Features' },
            { type: 'fix', section: '🐛 Bug Fixes' },
            { type: 'perf', section: '⚡ Performance Improvements' },
            { type: 'revert', section: '⏪ Reverts' },
            { type: 'docs', section: '📝 Documentation' },
            { type: 'style', section: '💄 Styles' },
            { type: 'refactor', section: '♻️ Code Refactoring' },
            { type: 'test', section: '✅ Tests' },
            { type: 'build', section: '👷 Build System' },
            { type: 'ci', section: '🔧 Continuous Integration' },
          ],
        },
      },
    ],
    [
      '@semantic-release/changelog',
      {
        changelogFile: 'CHANGELOG.md',
        changelogTitle: '<a name="readme-top"></a>\n\n# Changelog',
      },
    ],
    [
      '@semantic-release/npm',
      {
        npmPublish: false,
      },
    ],
    appendReleaseNotesPlugin,
    [
      '@semantic-release/github',
      {
        successComment: false,
        failComment: false,
        labels: false,
        releaseName: 'v${nextRelease.version}',
      },
    ],
    [
      '@semantic-release/git',
      {
        assets: ['CHANGELOG.md', 'package.json', 'package-lock.json'],
        message: 'chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}',
      },
    ],
  ],
};

releaseConfig.__internal = {
  appendReleaseNotes,
  buildReleaseFooter,
};

module.exports = releaseConfig;
