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
// Taken from: https://github.com/aws/aws-cdk/pull/18106
// Forked because ephemeral storage is not allowed to be set by the existing QueueProcessingFargateService in the CDK
import * as ec2 from '@aws-cdk/aws-ec2';
import { FargatePlatformVersion, FargateService, FargateTaskDefinition } from '@aws-cdk/aws-ecs';
import { QueueProcessingServiceBase, QueueProcessingServiceBaseProps } from '@aws-cdk/aws-ecs-patterns';
import { Construct } from '@aws-cdk/core';
import * as cxapi from '@aws-cdk/cx-api';

/**
 * The properties for the QueueProcessingFargateService service.
 */
export interface QueueProcessingFargateServiceProps extends QueueProcessingServiceBaseProps {
  /**
   * The number of cpu units used by the task.
   *
   * Valid values, which determines your range of valid values for the memory parameter:
   *
   * 256 (.25 vCPU) - Available memory values: 0.5GB, 1GB, 2GB
   *
   * 512 (.5 vCPU) - Available memory values: 1GB, 2GB, 3GB, 4GB
   *
   * 1024 (1 vCPU) - Available memory values: 2GB, 3GB, 4GB, 5GB, 6GB, 7GB, 8GB
   *
   * 2048 (2 vCPU) - Available memory values: Between 4GB and 16GB in 1GB increments
   *
   * 4096 (4 vCPU) - Available memory values: Between 8GB and 30GB in 1GB increments
   *
   * This default is set in the underlying FargateTaskDefinition construct.
   *
   * @default 256
   */
  readonly cpu?: number;

  /**
   * The amount (in MiB) of memory used by the task.
   *
   * This field is required and you must use one of the following values, which determines your range of valid values
   * for the cpu parameter:
   *
   * 0.5GB, 1GB, 2GB - Available cpu values: 256 (.25 vCPU)
   *
   * 1GB, 2GB, 3GB, 4GB - Available cpu values: 512 (.5 vCPU)
   *
   * 2GB, 3GB, 4GB, 5GB, 6GB, 7GB, 8GB - Available cpu values: 1024 (1 vCPU)
   *
   * Between 4GB and 16GB in 1GB increments - Available cpu values: 2048 (2 vCPU)
   *
   * Between 8GB and 30GB in 1GB increments - Available cpu values: 4096 (4 vCPU)
   *
   * This default is set in the underlying FargateTaskDefinition construct.
   *
   * @default 512
   */
  readonly memoryLimitMiB?: number;

  /**
   * The amount (in GiB) of ephemeral storage to be allocated to the task. The maximum supported value is 200 GiB.
   *
   * NOTE: This parameter is only supported for tasks hosted on AWS Fargate using platform version 1.4.0 or later.
   *
   * This default is set in the underlying FargateTaskDefinition construct.
   *
   * @default 20
   */
  readonly ephemeralStorageGiB?: number;

  /**
   * The platform version on which to run your service.
   *
   * If one is not specified, the LATEST platform version is used by default. For more information, see
   * [AWS Fargate Platform Versions](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/platform_versions.html)
   * in the Amazon Elastic Container Service Developer Guide.
   *
   * @default Latest
   */
  readonly platformVersion?: FargatePlatformVersion;

  /**
   * Optional name for the container added
   *
   * @default - QueueProcessingContainer
   */
  readonly containerName?: string;

  /**
   * The subnets to associate with the service.
   *
   * @default - Public subnets if `assignPublicIp` is set, otherwise the first available one of Private, Isolated, Public, in that order.
   */
  readonly taskSubnets?: ec2.SubnetSelection;

  /**
   * The security groups to associate with the service. If you do not specify a security group, a new security group is created.
   *
   * @default - A new security group is created.
   */
  readonly securityGroups?: ec2.ISecurityGroup[];

  /**
   * Specifies whether the task's elastic network interface receives a public IP address.
   *
   * If true, each task will receive a public IP address.
   *
   * @default false
   */
  readonly assignPublicIp?: boolean;
}

/**
 * Class to create a queue processing Fargate service
 */
export class QueueProcessingFargateService extends QueueProcessingServiceBase {
  /**
   * The Fargate service in this construct.
   */
  public readonly service: FargateService;
  /**
   * The Fargate task definition in this construct.
   */
  public readonly taskDefinition: FargateTaskDefinition;

  /**
   * Constructs a new instance of the QueueProcessingFargateService class.
   */
  constructor(scope: Construct, id: string, props: QueueProcessingFargateServiceProps) {
    super(scope, id, props);

    // Create a Task Definition for the container to start
    this.taskDefinition = new FargateTaskDefinition(this, 'QueueProcessingTaskDef', {
      memoryLimitMiB: props.memoryLimitMiB || 512,
      cpu: props.cpu || 256,
      ephemeralStorageGiB: props.ephemeralStorageGiB,
      family: props.family,
    });

    const containerName = props.containerName ?? 'QueueProcessingContainer';

    this.taskDefinition.addContainer(containerName, {
      image: props.image,
      command: props.command,
      environment: this.environment,
      secrets: this.secrets,
      logging: this.logDriver,
    });

    // The desiredCount should be removed from the fargate service when the feature flag is removed.
    const desiredCount = this.node.tryGetContext(cxapi.ECS_REMOVE_DEFAULT_DESIRED_COUNT)
      ? undefined
      : this.desiredCount;

    // Create a Fargate service with the previously defined Task Definition and configure
    // autoscaling based on cpu utilization and number of messages visible in the SQS queue.
    this.service = new FargateService(this, 'QueueProcessingFargateService', {
      cluster: this.cluster,
      desiredCount: desiredCount,
      taskDefinition: this.taskDefinition,
      serviceName: props.serviceName,
      minHealthyPercent: props.minHealthyPercent,
      maxHealthyPercent: props.maxHealthyPercent,
      propagateTags: props.propagateTags,
      enableECSManagedTags: props.enableECSManagedTags,
      platformVersion: props.platformVersion,
      deploymentController: props.deploymentController,
      securityGroups: props.securityGroups,
      vpcSubnets: props.taskSubnets,
      assignPublicIp: props.assignPublicIp,
      circuitBreaker: props.circuitBreaker,
      capacityProviderStrategies: props.capacityProviderStrategies,
    });

    this.configureAutoscalingForService(this.service);
    this.grantPermissionsToService(this.service);
  }
}
