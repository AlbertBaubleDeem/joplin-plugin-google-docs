import joplin from 'api';

(async () => {
  await joplin.plugins.register({
    onStart: async () => {
      await joplin.commands.register({
        name: 'gdocsHello',
        label: 'Google Docs Sync: Hello',
        execute: async () => {
          console.info('[gdocs] Skeleton plugin loaded');
        },
      });
    },
  });
})();
