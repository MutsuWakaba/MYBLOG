import { config, fields, collection } from '@keystatic/core';

export default config({
  storage: {
    kind: 'local',
  },
  collections: {
    posts: collection({
      label: 'Posts (文章)',
      slugField: 'title',
      path: 'src/content/posts/*',
      format: { contentField: 'content' },
      extension: 'md',
      schema: {
        title: fields.slug({ name: { label: 'Title (标题)' } }),
        published: fields.date({ label: 'Published Date (发布日期)', validation: { isRequired: true } }),
        description: fields.text({ label: 'Description (描述)', multiline: true }),
        tags: fields.array(fields.text({ label: 'Tag' }), { label: 'Tags (标签)', itemLabel: props => props.value }),
        category: fields.text({ label: 'Category (分类)' }),
        draft: fields.checkbox({ label: 'Draft (草稿)', defaultValue: false }),
        pinned: fields.checkbox({ label: 'Pinned (置顶)', defaultValue: false }),
        author: fields.text({ label: 'Author (作者)' }),
        content: fields.markdoc({ label: 'Content (正文内容)', extension: 'md' }),
      },
    }),
  },
});
