package dto

import (
	"bytes"
	"encoding/json"
	"math"
	"strconv"

	kitutil "github.com/QuantumNous/new-api/relaykit/relayconvert/kitutil"
)

type StringValue string

func (s *StringValue) UnmarshalJSON(data []byte) error {
	var str string
	if err := kitutil.Unmarshal(data, &str); err == nil {
		*s = StringValue(str)
		return nil
	}

	var raw json.Number
	if err := kitutil.Unmarshal(data, &raw); err == nil {
		*s = StringValue(raw.String())
		return nil
	}

	return kitutil.Unmarshal(data, &str)
}

func (s StringValue) MarshalJSON() ([]byte, error) {
	return kitutil.Marshal(string(s))
}

type IntValue int

func (i *IntValue) UnmarshalJSON(b []byte) error {
	var n int
	intErr := kitutil.Unmarshal(b, &n)
	if intErr == nil {
		*i = IntValue(n)
		return nil
	}
	var f float64
	if err := kitutil.Unmarshal(b, &f); err == nil {
		// Only decimal/exponent forms need the fallback; overflowing integers
		// must not be rounded back into range by float64 decoding.
		if !bytes.ContainsAny(b, ".eE") {
			return intErr
		}
		limit := math.Ldexp(1, strconv.IntSize-1)
		if math.IsNaN(f) || f < -limit || f >= limit {
			return strconv.ErrRange
		}
		*i = IntValue(int(f))
		return nil
	}
	var s string
	if err := kitutil.Unmarshal(b, &s); err != nil {
		return err
	}
	v, err := strconv.Atoi(s)
	if err != nil {
		return err
	}
	*i = IntValue(v)
	return nil
}

func (i IntValue) MarshalJSON() ([]byte, error) {
	return kitutil.Marshal(int(i))
}

type BoolValue bool

func (b *BoolValue) UnmarshalJSON(data []byte) error {
	var boolean bool
	if err := kitutil.Unmarshal(data, &boolean); err == nil {
		*b = BoolValue(boolean)
		return nil
	}
	var str string
	if err := kitutil.Unmarshal(data, &str); err != nil {
		return err
	}
	if str == "true" {
		*b = BoolValue(true)
	} else if str == "false" {
		*b = BoolValue(false)
	} else {
		return kitutil.Unmarshal(data, &boolean)
	}
	return nil
}
func (b BoolValue) MarshalJSON() ([]byte, error) {
	return kitutil.Marshal(bool(b))
}
