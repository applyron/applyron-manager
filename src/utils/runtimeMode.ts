import path from 'path';

export function isPackagedE2EEnvironment(): boolean {
  const inDevelopment = process.env.NODE_ENV === 'development';
  const isPackagedE2EPath =
    !inDevelopment &&
    [process.execPath, process.resourcesPath].some((candidatePath) =>
      candidatePath.includes(`${path.sep}out${path.sep}e2e${path.sep}`),
    );

  return process.env.APPLYRON_E2E === '1' || isPackagedE2EPath;
}
