package engine

type FallbackStep struct {
	ProviderType string
	Model        string
	Primary      bool
}

type FallbackPlan struct {
	Steps []FallbackStep
}

func (p FallbackPlan) First() (FallbackStep, bool) {
	if len(p.Steps) == 0 {
		return FallbackStep{}, false
	}
	return p.Steps[0], true
}
