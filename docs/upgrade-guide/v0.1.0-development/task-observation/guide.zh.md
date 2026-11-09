---
kind: upgrade-guide
description: "可信任务服务实现与完整设置对象新增任务观察方法和观察者上限。"
---
# 升级任务观察接口

## 变更

任务服务新增 subscribe、wait、join。声明为 JobDeliveryService 的实现和替身需要提供这些方法。通过 schema 解析的设置新增 maxObservers，默认 256；手写完整 Settings 对象需要补充此值。已有保存配置仍有效。

任务存储 schema 保持 1，已有记录、参数、产物的字段与位置不变，无需迁移，也不会自动重放。

## 迁移

1. 为 JobDeliveryService 的实现与替身更新 subscribe、wait、join。wait 等待单个任务的原生工作与产物结束；取消等待不会取消任务。需要负责取消和资源清理时，调用 cancel 后再 join。
2. 通过 Config 解析设置，或为完整设置对象补充 maxObservers。每项订阅占用一个位置，释放器执行后归还；wait 也临时占用一个位置。
3. 升级 bundle 并重载浏览器或桌面客户端，检查所有者页面能设置观察者上限并保留已有任务。更新消费插件时执行定点的任务观察测试。
