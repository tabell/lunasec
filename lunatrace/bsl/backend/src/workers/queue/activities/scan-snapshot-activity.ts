/*
 * Copyright by LunaSec (owned by Refinery Labs, Inc)
 *
 * Licensed under the Business Source License v1.1
 * (the "License"); you may not use this file except in compliance with the
 * License. You may obtain a copy of the License at
 *
 * https://github.com/lunasec-io/lunasec/blob/master/licenses/BSL-LunaTrace.txt
 *
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 */
import { Readable } from 'stream';
import zlib from 'zlib';

import validate from 'validator';

import { interactWithPR } from '../../../github/actions/pr-comment-generator';
import { updateBuildStatus } from '../../../hasura-api/actions/update-build-status';
import { updateManifestStatus } from '../../../hasura-api/actions/update-manifest-status';
import { Build_State_Enum } from '../../../hasura-api/generated';
import { InsertedScan, performSnapshotScanAndCollectReport } from '../../../models/scan';
import { S3ObjectMetadata } from '../../../types/s3';
import { SbomBucketInfo } from '../../../types/scan';
import { MaybeError } from '../../../types/util';
import { aws } from '../../../utils/aws-utils';
import { newError, newResult } from '../../../utils/errors';
import { log } from '../../../utils/log';
import { catchError, threwError } from '../../../utils/try';

function decompressGzip(stream: Readable, streamLength: number): Promise<zlib.Gzip> {
  return new Promise((resolve, reject) => {
    log.info('started streaming file from s3');

    const chunkSize = streamLength < 1024 * 256 ? streamLength : 1024 * 256;

    const gunzip = zlib.createGunzip({ chunkSize: chunkSize < 64 ? 64 : chunkSize });

    log.info('started unzipping file');
    const unZippedSbomStream = stream.pipe(gunzip);
    unZippedSbomStream.on('error', (e) => {
      log.error('Error unzipping sbom ', e);
      unZippedSbomStream.end(() => log.info('closed stream due to error'));
      reject(e);
    });

    resolve(unZippedSbomStream);
  });
}

async function scanSnapshot(buildId: string, sbomBucketInfo: SbomBucketInfo): Promise<InsertedScan | null> {
  const [sbomStream, sbomLength] = await aws.getFileFromS3(
    sbomBucketInfo.key,
    sbomBucketInfo.bucketName,
    sbomBucketInfo.region
  );

  if (sbomLength === 0) {
    log.error('SBOM length is zero.');
    updateBuildStatus(buildId, Build_State_Enum.SnapshotScanFailed, 'Internal error while scanning snapshot.');
    return null;
  }

  const unZippedSbomStream = await decompressGzip(sbomStream, sbomLength);

  log.info('Starting to scan snapshot.');
  updateBuildStatus(buildId, Build_State_Enum.SnapshotScanStarted);
  updateManifestStatus(buildId, 'scanning');

  const scanReport = await performSnapshotScanAndCollectReport(unZippedSbomStream, buildId);
  if (scanReport === null) {
    log.error('Failed to scan snapshot.');
    updateBuildStatus(buildId, Build_State_Enum.SnapshotScanFailed, 'Internal error while scanning snapshot.');
    return null;
  }
  return scanReport;
}

export async function scanSnapshotActivity(buildId: string, msg: S3ObjectMetadata): Promise<MaybeError<undefined>> {
  const { key, region, bucketName } = msg;
  return await log.provideFields({ key, region, bucketName }, async () => {
    if (!buildId || !validate.isUUID(buildId)) {
      log.error('invalid build uuid from s3 object at key ', {
        key,
      });
      // not much we can do without a valid buildId
      return newError('invalid build uuid from s3 object at key ' + key);
    }

    const bucketInfo: SbomBucketInfo = { region, bucketName, key };

    const scanResp = await catchError(scanSnapshot(buildId, bucketInfo));
    if (threwError(scanResp)) {
      log.error('Failed to scan snapshot.');
      updateBuildStatus(buildId, Build_State_Enum.SnapshotScanFailed, scanResp.message);
      updateManifestStatus(buildId, 'error', String(scanResp.message));
      return newError(scanResp.message);
    }

    if (scanResp === null) {
      log.error('failed to scan snapshot due to invalid SBOM');
      updateBuildStatus(buildId, Build_State_Enum.SnapshotScanFailed, 'Invalid SBOM was requested to be scanned.');
      updateManifestStatus(buildId, 'error', 'invalid SBOM was requested to be scanned');
      return newResult(undefined);
    }

    log.info('Successfully scanned snapshot.');
    updateBuildStatus(buildId, Build_State_Enum.SnapshotScanCompleted);
    updateManifestStatus(buildId, 'scanned');

    try {
      await interactWithPR(buildId, scanResp);
    } catch (e) {
      log.error('commenting on github pr failed, continuing.. ', {
        error: e,
      });
    }

    return newResult(undefined);
  });
}
