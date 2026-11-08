import { useI18n } from '../../i18n';
import { EmptyState, TitleRow } from '../ui';

/** Business management › Data continuity: the continuity of the data of each business service. Coming soon. */
export const DataContinuityPage = () => {
  const { t } = useI18n();
  return (
    <>
      <TitleRow crumbs={[[t('nav.portal'), '/console'], [t('nav.businessManagement')], [t('nav.dataContinuity')]]} title={t('nav.dataContinuity')} sub={t('dc.sub')} />
      <EmptyState title={t('dc.soon')}>{t('dc.soon.text')}</EmptyState>
    </>
  );
};
