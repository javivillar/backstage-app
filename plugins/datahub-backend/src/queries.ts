// GraphQL documents. READ-ONLY by construction: there is not a single
// mutation in this file and datahubClient.ts refuses to send one.
// Phase 1 of BACKSTAGE-DATAHUB-DESIGN.md.

const COMMON = `
  ownership { owners { ownershipType { urn info { name } } owner { ... on CorpUser { urn username } ... on CorpGroup { urn name } } } }
  domain { domain { urn properties { name } } }
  tags { tags { tag { urn properties { name } } } }
  glossaryTerms { terms { term { urn name } } }
  structuredProperties { properties { structuredProperty { urn definition { qualifiedName } } values { ... on StringValue { stringValue } ... on NumberValue { numberValue } } } }
  deprecation { deprecated note }
`;

const DATASET = `
  urn name platform { name }
  properties { name description customProperties { key value } }
  editableProperties { description }
  schemaMetadata { fields { fieldPath description } }
  editableSchemaMetadata { editableSchemaFieldInfo { fieldPath description } }
  ${COMMON}
`;

const DATA_PRODUCT = `urn properties { name description } ${COMMON}`;
const DATA_FLOW = `urn platform { name } properties { name description } ${COMMON}`;

export const ASSET_FRAGMENTS = `
  ... on Dataset { ${DATASET} }
  ... on DataProduct { ${DATA_PRODUCT} }
  ... on DataFlow { ${DATA_FLOW} }
`;

export const Q_DATASET = `query($urn: String!) { dataset(urn: $urn) { ${DATASET} } }`;
export const Q_DATA_PRODUCT = `query($urn: String!) { dataProduct(urn: $urn) { ${DATA_PRODUCT} } }`;
export const Q_DATA_FLOW = `query($urn: String!) { dataFlow(urn: $urn) { ${DATA_FLOW} } }`;

export const Q_SEARCH = `
  query($input: SearchAcrossEntitiesInput!) {
    searchAcrossEntities(input: $input) {
      total
      searchResults { entity { type ${ASSET_FRAGMENTS} } }
    }
  }
`;

const vocab = (types: string, fragment: string) => `
  query { searchAcrossEntities(input: { query: "*", start: 0, count: 300, types: [${types}] }) {
    searchResults { entity { ${fragment} } }
  } }
`;

export const Q_VOCAB_DOMAINS = vocab('DOMAIN', '... on Domain { urn properties { name description } }');
export const Q_VOCAB_TERMS = vocab('GLOSSARY_TERM', '... on GlossaryTerm { urn name properties { name description } }');
export const Q_VOCAB_TAGS = vocab('TAG', '... on Tag { urn properties { name description } }');
export const Q_VOCAB_PROPERTIES = vocab(
  'STRUCTURED_PROPERTY',
  '... on StructuredPropertyEntity { urn definition { qualifiedName displayName allowedValues { value { ... on StringValue { stringValue } ... on NumberValue { numberValue } } } } }',
);
