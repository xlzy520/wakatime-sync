require('dotenv').config()
const { WakaTimeClient, RANGE } = require('wakatime-client')
const core = require('@actions/core')
const dayjs = require('dayjs')
const { Octokit } = require('@octokit/rest')
const Axios = require('axios')

const date = core.getInput('date')

const { WAKATIME_API_KEY, GH_TOKEN, GIST_ID, SCU_KEY } = process.env
const BASE_URL = 'https://wakatime.com/api/v1'
const summariesApi = `${BASE_URL}/users/current/summaries`
const scuPushApi = `https://sc.ftqq.com`

const wakatime = new WakaTimeClient(WAKATIME_API_KEY)
const octokit = new Octokit({
  auth: `token ${GH_TOKEN}`
})

function getItemContent(title, content) {
  let itemContent = `#### ${title} \n`
  content.forEach(item => {
    itemContent += `* ${item.name}: ${item.text} \n`
  })
  return itemContent
}

function getMessageContent(date, summary) {
  if (summary.length > 0) {
    const { projects, grand_total, languages, categories, editors } = summary[0]
    if (!grand_total.total_seconds) {
      return '啊啊啊，今天居然没有写代码！！！'
    }

    return `## Wakatime Daily Report\nTotal: ${grand_total.text}\n${getItemContent(
      'Projects',
      projects
    )}\n${getItemContent('Languages', languages)}\n${getItemContent(
      'Editors',
      editors
    )}\n${getItemContent('Categories', categories)}\n`
  }
}

function getMySummary(date) {
  return Axios.get(summariesApi, {
    params: {
      start: date,
      end: date,
      api_key: WAKATIME_API_KEY
    }
  }).then(response => response.data.data)
}

/**
 * update wakatime content to gist
 * @param {*} date - update date
 * @param {*} content update content
 */
async function updateGist(date, content) {
  try {
    await octokit.gists.update({
      gist_id: GIST_ID,
      files: {
        [`summaries_${date}.json`]: {
          content: JSON.stringify(content)
        }
      }
    })
  } catch (error) {
    console.error(`Unable to update gist \n ${error}`)
  }
}

/**
 * 推送消息到 Server酱
 * @param {*} text 标题，最初256，必需
 * @param {*} desp 消息内容，最长64kb，可空
 */
async function sendMessageToWechat(text, desp) {
  console.log(text, desp)
  return Axios.get(`https://express.xlzy520.cn/push`, {
    params: {
      text: text + '-----分割线-----' + desp,
      desp
    }
  })
    .then(response => {
      console.log('消息推送成功')
      return response.data
    })
    .catch(err => {
      Axios.get(`https://service-ijd4slqi-1253419200.gz.apigw.tencentcs.com/release/push`, {
        params: {
          text: 'SSL证书失效' + text + '-----分割线-----' + desp,
          desp
        }
      })
    })
}

const fetchSummaryWithRetry = async times => {
  // 增加一天
  const yesterday =
    date ||
    dayjs()
      .subtract(1, 'day')
      .format('YYYY-MM-DD')
  try {
    const mySummary = await getMySummary(yesterday)
    if (mySummary.length > 0) {
      const { grand_total } = mySummary[0]
      const total_seconds = grand_total.total_seconds
      if (total_seconds) {
        await updateGist(yesterday, mySummary)
      }
    }
    await sendMessageToWechat(
      `${yesterday} update successfully!`,
      getMessageContent(yesterday, mySummary)
    )
  } catch (error) {
    console.log(error.response.data, '===========打印的 ------ fetchSummary Error')
    if (times === 1) {
      console.error(`Unable to fetch wakatime summary\n ${error} `)
      return await sendMessageToWechat(`[${yesterday}]failed to update wakatime data!`)
    }
    console.log(`retry fetch summary data: ${times - 1} time`)
    fetchSummaryWithRetry(times - 1)
  }
}

async function main() {
  fetchSummaryWithRetry(3)
}

main()
