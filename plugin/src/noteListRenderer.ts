import { ListRenderer, ItemFlow, OnRenderNoteHandler } from 'api/noteListType';
import { getBinding } from './mapping';

/**
 * Custom note list renderer that shows Google Docs sync status
 */
export function createSyncStatusRenderer(dataDir: string): ListRenderer {
  return {
    id: 'gdocs-sync-renderer',
    
    label: async () => 'Default with sync status',
    
    flow: ItemFlow.TopToBottom,
    
    itemSize: {
      width: 0,
      height: 34,
    },
    
    dependencies: [
      'item.selected',
      'note.id',
      'note.is_shared',
      'note.is_todo',
      'note.isWatched',
      'note.title',
      'note.todo_completed',
      'note.todoStatusText',
    ],
    
    itemCss: `
      &:before {
        content: '';
        border-bottom: 1px solid var(--joplin-divider-color);
        width: 90%;
        position: absolute;
        bottom: 0;
        left: 5%;
      }
      
      > .content.-selected {
        background-color: var(--joplin-selected-color);
      }
      
      &:hover, &.-focus-visible > .content {
        background-color: var(--joplin-background-color-hover3);
      }
      
      > .content {
        display: flex;
        box-sizing: border-box;
        position: relative;
        width: 100%;
        padding-left: 16px;
        
        > .checkbox {
          display: flex;
          align-items: center;
          
          > input {
            margin: 0px 10px 1px 0px;
          }
        }
        
        > .title {
          font-family: var(--joplin-font-family);
          font-size: var(--joplin-font-size);
          text-decoration: none;
          color: var(--joplin-color);
          cursor: default;
          white-space: nowrap;
          flex: 1 1 0%;
          display: flex;
          align-items: center;
          overflow: hidden;
          
          > .sync-icon {
            margin-right: 6px;
            font-size: 14px;
            opacity: 0.8;
            min-width: 20px;
            text-align: center;
            display: inline-flex;
            align-items: center;
            
            > .gdocs-icon {
              width: 16px;
              height: 16px;
              background-image: url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA0OCA0OCI+CiAgPHBhdGggZmlsbD0iIzQyODVGNCIgZD0iTTM3IDQ1SDExYy0xLjEgMC0yLS45LTItMlY1YzAtMS4xLjktMiAyLTJoMTlsOSA5djMxYzAgMS4xLS45IDItMiAyeiIvPgogIDxwYXRoIGZpbGw9IiNGRkYiIGQ9Ik0yOCAyM0gxNmMtLjYgMC0xLS40LTEtMXMuNC0xIDEtMWgxMmMuNiAwIDEgLjQgMSAxcy0uNCAxLTEgMXptMCA0SDE2Yy0uNiAwLTEtLjQtMS0xcy40LTEgMS0xaDEyYy42IDAgMSAuNCAxIDFzLS40IDEtMSAxem0wIDRIMTZjLS42IDAtMS0uNC0xLTFzLjQtMSAxLTFoMTJjLjYgMCAxIC40IDEgMXMtLjQgMS0xIDF6bTQgNEgxNmMtLjYgMC0xLS40LTEtMXMuNC0xIDEtMWgxNmMuNiAwIDEgLjQgMSAxcy0uNCAxLTEgMXoiLz4KICA8cGF0aCBmaWxsPSIjQTFDMkZBIiBkPSJNMzcgMTJoLTdjLS42IDAtMS0uNC0xLTFWNGw4IDh6Ii8+Cjwvc3ZnPg==");
              background-size: contain;
              background-repeat: no-repeat;
            }
          }
          
          > .watchedicon {
            display: none;
            padding-right: 4px;
            color: var(--joplin-color);
          }
          
          > .title-text {
            overflow: hidden;
            text-overflow: ellipsis;
          }
        }
      }
      
      > .content.-shared {
        > .title {
          color: var(--joplin-color-warn3);
        }
      }
      
      > .content.-completed {
        > .title {
          opacity: 0.5;
        }
      }
      
      > .content.-watched {
        > .title {
          > .watchedicon {
            display: inline;
          }
        }
      }
    `,
    
    itemTemplate: `
      <div class="content {{#item.selected}}-selected{{/item.selected}} {{#note.is_shared}}-shared{{/note.is_shared}} {{#note.todo_completed}}-completed{{/note.todo_completed}} {{#note.isWatched}}-watched{{/note.isWatched}}">
        {{#note.is_todo}}
          <div class="checkbox">
            <input
              data-id="todo-checkbox"
              type="checkbox"
              aria-label="{{note.todoStatusText}}"
              tabindex="-1"
              {{#note.todo_completed}}checked="checked"{{/note.todo_completed}}
            >
          </div>
        {{/note.is_todo}}
        <div class="title" data-id="{{note.id}}">
          <span class="sync-icon" title="{{syncTooltip}}">{{{syncIcon}}}</span>
          <i class="watchedicon fa fa-share-square"></i>
          <span class="title-text">{{note.title}}</span>
        </div>
      </div>
    `,
    
    onRenderNote: (async (props: any) => {
      // Get sync status for this note
      const binding = getBinding(dataDir, props.note.id);
      
      let syncIcon = '';
      let syncTooltip = 'Not synced with Google Docs';
      
      if (binding?.fileId) {
        // Custom Google Docs icon for synced notes
        syncIcon = '<div class="gdocs-icon"></div>';
        syncTooltip = 'Synced with Google Docs';
      }
      
      return {
        ...props,
        syncIcon,
        syncTooltip,
      };
    }) as OnRenderNoteHandler,
  };
}
