import { useEffect, useState, type JSX } from 'react'
import type { NewsItem } from '@shared/types'
import { t } from '../lib/i18n'
import { EmptyState, SkeletonRows } from '../components/ui'
import { IconInfo } from '../components/Icons'
import { NewsCard } from './Home'

/**
 * The full news list, which the home screen only ever showed the first six
 * of. Same source and the same card, so the two cannot drift apart.
 */
export function NewsView(): JSX.Element {
  const [news, setNews] = useState<NewsItem[] | null>(null)

  useEffect(() => {
    void window.gabi.news
      .list(30)
      .then(setNews)
      .catch(() => setNews([]))
  }, [])

  return (
    <div className="col gap-24">
      <header>
        <h1 className="page-title">{t('instanceSettings', 'news.pageTitle')}</h1>
        <p className="page-sub">{t('instanceSettings', 'news.pageSubtitle')}</p>
      </header>

      {news === null ? (
        <SkeletonRows count={5} />
      ) : news.length === 0 ? (
        <EmptyState
          icon={<IconInfo size={26} />}
          title={t('instanceSettings', 'news.emptyTitle')}
          message={t('instanceSettings', 'news.emptyMessage')}
        />
      ) : (
        <div className="discover-grid stagger">
          {news.map((item) => (
            <NewsCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  )
}
