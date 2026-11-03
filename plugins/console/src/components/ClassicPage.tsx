import Box from '@mui/material/Box';
import type { ConsoleClassicPage } from '../pages';
import { useI18n } from '../i18n';
import { ClassicFrame } from './ClassicFrame';
import { ClassicLink } from './ClassicLink';
import { TitleRow } from './ui';

/** /console/<id>/*: a classic page under the console header. */
export const ClassicPage = ({ page }: { page: ConsoleClassicPage }) => {
  const { t, has } = useI18n();
  const title = has(`page.${page.id}`) ? t(`page.${page.id}`) : page.title;
  return (
    <Box>
      <TitleRow title={title} sub={page.product} actions={<ClassicLink path={page.classicPath} />} />
      <ClassicFrame entity>{page.element}</ClassicFrame>
    </Box>
  );
};
