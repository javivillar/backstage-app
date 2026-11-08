import express, { Router } from 'express';
import { GitHubFiles } from '../clusterVms';
import { ExerciseError, exercisePath, exercisePull, exerciseSlug, exerciseYaml, readExercise } from './exercisesModel';
import { type BusinessMapRouteDeps, statusOf, whoAsks } from './previewRouter';

/**
 *   POST /api/business-map/exercises   { namespace, failed: [ref], processes: [{ ref, result, marginMinutes }], note? }
 *        → { pull: { number, url }, path }: "Save as exercise" of the matrix; opens a pull request in
 *        refresquito-specs with continuity/exercises/<namespace>/<yyyy-mm-dd>-<slug>.yaml (exercisesModel.ts says
 *        what an exercise is)
 *
 * Who may: business-architect, backstage-admin and console.actions.groups. Config: businessMap.exercises.repo
 * (default javivillar/refresquito-specs) and businessMap.exercises.branch (default main); the GitHub token of the
 * backend needs Contents and Pull requests: write on that repository.
 */

/** How many exercises with the same slug one day may have (-2, -3...). */
const SAME_DAY = 20;

export function createExercisesRouter(deps: BusinessMapRouteDeps): Router {
  const { config, logger } = deps;
  const who = whoAsks(deps);
  const token = config.getOptionalConfigArray('integrations.github')?.[0]?.getOptionalString('token');
  const specs = new GitHubFiles(
    config.getOptionalString('businessMap.exercises.repo') ?? 'javivillar/refresquito-specs',
    config.getOptionalString('businessMap.exercises.branch') ?? 'main',
    token,
  );

  const router = Router();
  router.post('/exercises', express.json({ limit: '512kb' }), async (req, res) => {
    try {
      const w = await who(req);
      if (!w.may) {
        res.status(403).json({ error: `Only ${w.groups.join(', ')} may save a continuity exercise.` });
        return;
      }
      const e = readExercise(req.body);
      const date = new Date().toISOString().slice(0, 10);
      // the same failure saved twice on one day: the second file is <date>-<slug>-2.yaml
      let path: string | undefined;
      for (let n = 1; n <= SAME_DAY && !path; n++) {
        const candidate = exercisePath(e, date, n);
        if (!(await specs.sha(candidate))) path = candidate;
      }
      if (!path) {
        res.status(409).json({ error: `There are already ${SAME_DAY} exercises ${exerciseSlug(e)} of ${e.namespace} today.` });
        return;
      }
      const { title, body } = exercisePull(e, { date, by: w.user, path });
      const pull = await specs.pullRequest(`exercise-${e.namespace}-${exerciseSlug(e)}`.slice(0, 80), title, body, [
        { path, text: exerciseYaml(e, { date, by: w.user }) },
      ]);
      logger.info(`business-map: exercise ${path} by ${w.user}: pull request #${pull.number}`);
      res.json({ pull, path });
    } catch (e) {
      if (e instanceof ExerciseError) {
        res.status(400).json({ error: e.message });
        return;
      }
      const status = statusOf(e, 502);
      if (status === 502) logger.warn(`business-map exercises: ${(e as Error).message}`);
      res.status(status).json({ error: (e as Error).message });
    }
  });
  return router;
}
