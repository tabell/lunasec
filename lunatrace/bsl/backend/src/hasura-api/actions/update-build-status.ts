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
import { Build_State_Enum } from '../generated';
import { hasura } from '../index';

// insertBuildLog inserts a build log asynchronously, without waiting for a response.
export function updateBuildStatus(buildId: string, state: Build_State_Enum, message?: string) {
  void hasura.InsertBuildLog({
    build_log: {
      build_id: buildId,
      state,
      message,
    },
  });
}
