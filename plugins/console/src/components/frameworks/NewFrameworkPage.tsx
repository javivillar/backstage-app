import { useI18n } from '../../i18n';
import { EmptyState, TitleRow } from '../ui';

/** Development › New framework: adding a framework of your own to the platform. Coming soon. */
export const NewFrameworkPage = () => {
  const { t } = useI18n();
  return (
    <>
      <TitleRow crumbs={[[t('nav.portal'), '/console'], [t('nav.development')], [t('nav.newFramework')]]} title={t('nav.newFramework')} sub={t('nf.sub')} />
      <EmptyState title={t('nf.soon')}>{t('nf.soon.text')}</EmptyState>
    </>
  );
};
