/**
 * @absuite/connector-starter — connector registry, credential verification and
 * deterministic connector scaffolding.
 */
export {
  CONNECTORS,
  getConnector,
  isConfigured,
  missingEnv,
  describeConnectors,
  verifyConnector,
  runAction,
  type ConnectorDefinition,
  type ConnectorAction,
  type ConnectorResult,
} from './connectors';

export {
  generate,
  analyse,
  toManifest,
  toTypeScript,
  slugify,
  type ConnectorSpec,
} from './scaffold';
