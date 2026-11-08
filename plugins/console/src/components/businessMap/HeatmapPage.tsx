import { useI18n } from '../../i18n';
import { EmptyState, TitleRow } from '../ui';
import { BusinessMapTabs } from './BusinessMapTabs';

/** Stub of worker F's page (release 2): the lead merges the real one over it. */
export const BusinessHeatmapPage = () => {
  const { t } = useI18n();
  return (
    <>
      <TitleRow crumbs={[[t('nav.portal'), '/console'], [t('nav.businessMap'), '/console/business-map'], [t('bm.view.heat')]]} title={t('bm.view.heat')} actions={<BusinessMapTabs />} />
      <EmptyState title={t('bm.view.heat')} />
    </>
  );
};
