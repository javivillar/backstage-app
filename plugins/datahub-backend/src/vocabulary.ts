import { DatahubSettings, datahubQuery } from './datahubClient';
import { Q_VOCAB_DOMAINS, Q_VOCAB_PROPERTIES, Q_VOCAB_TAGS, Q_VOCAB_TERMS } from './queries';

type Page<E> = { searchAcrossEntities: { searchResults: Array<{ entity: E }> } };
type Named = { urn: string; name?: string; properties?: { name?: string; description?: string } };

export interface VocabularyItem {
  urn: string;
  name: string;
  description?: string;
}

export interface VocabularyResult {
  domains: VocabularyItem[];
  glossaryTerms: VocabularyItem[];
  tags: VocabularyItem[];
  structuredProperties: Array<{
    urn: string;
    qualifiedName: string;
    displayName?: string;
    allowedValues: Array<string | number | undefined>;
  }>;
}

const item = (e: Named): VocabularyItem => ({
  urn: e.urn,
  name: e.properties?.name ?? e.name ?? e.urn,
  description: e.properties?.description,
});

/** The controlled vocabulary DataHub already has (design §9): read for the /vocabulary route and to validate briefs. */
export async function loadVocabulary(settings: Pick<DatahubSettings, 'baseUrl' | 'token'>): Promise<VocabularyResult> {
  type Prop = {
    urn: string;
    definition?: {
      qualifiedName: string;
      displayName?: string;
      allowedValues?: Array<{ value: { stringValue?: string; numberValue?: number } }>;
    };
  };
  const [d, t, g, p] = await Promise.all([
    datahubQuery<Page<Named>>(settings, Q_VOCAB_DOMAINS),
    datahubQuery<Page<Named>>(settings, Q_VOCAB_TERMS),
    datahubQuery<Page<Named>>(settings, Q_VOCAB_TAGS),
    datahubQuery<Page<Prop>>(settings, Q_VOCAB_PROPERTIES),
  ]);
  return {
    domains: d.searchAcrossEntities.searchResults.map(r => item(r.entity)),
    glossaryTerms: t.searchAcrossEntities.searchResults.map(r => item(r.entity)),
    tags: g.searchAcrossEntities.searchResults.map(r => item(r.entity)),
    structuredProperties: p.searchAcrossEntities.searchResults
      .filter(r => r.entity.definition)
      .map(r => ({
        urn: r.entity.urn,
        qualifiedName: r.entity.definition!.qualifiedName,
        displayName: r.entity.definition!.displayName,
        allowedValues: (r.entity.definition!.allowedValues ?? []).map(a => a.value.stringValue ?? a.value.numberValue),
      })),
  };
}
